"""Vertex AI Gemini implementation of `AudioToSoap`.

One call: audio bytes in, `{transcript, SoapNote}` out. Uses the multimodal
input capability of Gemini 2.5 (Flash by default, Pro via VERTEX_MODEL env var).

Safety / clinical guardrails are enforced via the prompt — the LLM is instructed
never to invent vitals, diagnoses, dosages, or findings. The Pydantic schema
validation after the call is the second guardrail.
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

from pydantic import ValidationError

from app.interfaces.audio_to_soap import (
    AudioToSoap,
    AudioToSoapError,
    AudioToSoapResult,
)
from app.models.soap import SoapNote

logger = logging.getLogger(__name__)


_PROMPT_TEMPLATE = """You are a medical scribe assistant. The doctor has provided an audio recording of a patient encounter.

YOUR TASK:
1. TRANSCRIBE the audio verbatim into the `transcript` field.
2. EXTRACT a structured SOAP note from the transcript into the `soap` field.

CRITICAL SAFETY RULES — VIOLATING THESE COULD HARM A PATIENT:
- EXTRACT ONLY content present in the audio. NEVER invent vitals, diagnoses, dosages, findings, or any clinical content.
- If a field was not mentioned in the dictation, leave it null / empty / [].
- For vital signs (BP, HR, RR, temp, SpO2, weight, height, pain): do NOT guess or fill normal-range values. If not stated → null.
- For patient name / age / sex: extract only if explicitly stated. If not stated → name="", age=null, sex=null.
- `sex` MUST be exactly one of (lowercase): "male", "female", "other", "unknown". Never use "M", "F", capitalized variants, or any other string.
- Render dosages exactly as stated (e.g. "10 mg", not "10mg" or "10 milligrams").
- If the audio is silent, unintelligible, or clearly not a clinical dictation, return empty SOAP fields rather than guessing.

Encounter date if not stated in audio: {encounter_date_iso}

RESPONSE FORMAT — return ONLY this JSON object, no markdown fences, no commentary:

{{
  "transcript": "verbatim transcription of the audio",
  "soap": {{
    "patient": {{
      "name": "string",
      "age": null,
      "sex": null,
      "encounter_date": "{encounter_date_iso_date}"
    }},
    "subjective": {{
      "chief_complaint": null,
      "history_present_illness": null,
      "symptoms": [],
      "relevant_history": null,
      "current_medications": [],
      "allergies": []
    }},
    "objective": {{
      "vitals": {{
        "blood_pressure": null, "heart_rate_bpm": null, "respiratory_rate": null,
        "temperature_c": null, "spo2_percent": null, "weight_kg": null,
        "height_cm": null, "pain_scale_0_10": null
      }},
      "physical_exam": null,
      "findings": [],
      "labs_reviewed": []
    }},
    "assessment": {{"impressions": [], "diagnoses": []}},
    "plan": {{
      "medications": [], "tests_ordered": [], "procedures": [],
      "follow_up": null, "patient_education": null, "referrals": []
    }}
  }}
}}

Each medication object: {{"name": "...", "dose": null, "route": null, "frequency": null, "duration": null, "notes": null}}
Each allergy object: {{"substance": "...", "reaction": null, "severity": null}}
"""


def _build_prompt(encounter_date_iso: str) -> str:
    return _PROMPT_TEMPLATE.format(
        encounter_date_iso=encounter_date_iso,
        encounter_date_iso_date=encounter_date_iso[:10],
    )


class VertexGeminiAudioToSoap:
    """Implements `AudioToSoap` against Vertex AI Gemini.

    `vertexai.init` is a global side-effect; we guard it with a lock so
    parallel requests don't double-init.
    """

    PROVIDER_NAME = "vertex-gemini"

    _init_lock = threading.Lock()
    _initialized = False

    def __init__(self, *, project: str, location: str, model: str) -> None:
        if not project:
            raise AudioToSoapError("not_configured", "VERTEX_PROJECT_ID is not set")
        self._project = project
        self._location = location
        self._model_name = model
        self._model: Any = None  # lazy-init

    def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        # Import inside the method so the rest of the app boots without vertexai
        # installed (useful when the user is on the fake provider).
        import vertexai
        from vertexai.generative_models import GenerativeModel

        with self._init_lock:
            if not VertexGeminiAudioToSoap._initialized:
                vertexai.init(project=self._project, location=self._location)
                VertexGeminiAudioToSoap._initialized = True
        self._model = GenerativeModel(self._model_name)
        return self._model

    def process(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        encounter_date_iso: str,
    ) -> AudioToSoapResult:
        from vertexai.generative_models import (
            GenerationConfig,
            HarmBlockThreshold,
            HarmCategory,
            Part,
        )

        model = self._ensure_model()
        prompt = _build_prompt(encounter_date_iso)

        audio_part = Part.from_data(audio_bytes, mime_type=mime_type)

        config = GenerationConfig(
            response_mime_type="application/json",
            temperature=0.1,
            max_output_tokens=8192,
        )

        # Medical content can trip the default safety filters (e.g. genital
        # exam findings → SEXUALLY_EXPLICIT). The clinician is the audience;
        # we accept the trade-off for v1.
        safety_settings = {
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        try:
            response = model.generate_content(
                [audio_part, prompt],
                generation_config=config,
                safety_settings=safety_settings,
            )
        except Exception as e:
            # Don't echo internal SDK errors back to clients verbatim;
            # they may include token snippets or project IDs.
            logger.exception("vertex_gemini_generation_failed")
            raise AudioToSoapError("provider_error", "vertex_generation_failed") from e

        if not response.candidates:
            raise AudioToSoapError("no_response", "model returned no candidates")

        candidate = response.candidates[0]
        finish_reason_name = getattr(candidate.finish_reason, "name", str(candidate.finish_reason))
        if finish_reason_name not in ("STOP", "MAX_TOKENS"):
            raise AudioToSoapError(
                "content_blocked",
                f"model finished with reason {finish_reason_name.lower()}",
            )

        try:
            text = response.text
        except Exception as e:  # SDK raises if content is missing
            raise AudioToSoapError("no_response", "model returned empty content") from e

        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise AudioToSoapError("invalid_json", "model output was not valid JSON") from e

        if not isinstance(data, dict) or "transcript" not in data or "soap" not in data:
            raise AudioToSoapError("invalid_json", "model output missing required keys")

        transcript = data.get("transcript", "")
        if not isinstance(transcript, str):
            raise AudioToSoapError("invalid_json", "transcript field was not a string")

        try:
            soap = SoapNote.model_validate(data["soap"])
        except ValidationError as e:
            # Log field paths + error types (no PHI — the failing values are
            # excluded so we never leak transcripts or patient strings).
            details = [
                {"loc": ".".join(str(p) for p in err.get("loc", [])), "type": err.get("type")}
                for err in e.errors()
            ]
            logger.warning(
                "vertex_gemini_schema_validation_failed errors=%d details=%s",
                len(e.errors()),
                details,
            )
            raise AudioToSoapError(
                "schema_validation_failed",
                "model output did not match SOAP schema",
            ) from e

        # Stamp provenance after validation so it's authoritative.
        soap = soap.model_copy(
            update={
                "llm_provider": self.PROVIDER_NAME,
                "llm_model_version": self._model_name,
                "validated": True,
            }
        )

        usage = getattr(response, "usage_metadata", None)
        prompt_tokens = getattr(usage, "prompt_token_count", None) if usage else None
        output_tokens = getattr(usage, "candidates_token_count", None) if usage else None

        return AudioToSoapResult(
            transcript=transcript,
            soap=soap,
            provider=self.PROVIDER_NAME,
            model_version=self._model_name,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
        )
