"""Gemini API (AI Studio key) transport for the eval, for when Vertex billing is off.

Sends the production prompt and generation settings from app/providers/vertex_gemini.py
over the public Gemini API, then parses and validates the answer the same way the
provider does. The key comes from GEMINI_API_KEY (environment or backend/.env) and is
only ever sent as a request header.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from app.interfaces.audio_to_soap import AudioToSoapError, AudioToSoapResult
from app.models.soap import SoapNote
from app.providers.vertex_gemini import _build_prompt

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
SAFETY_OFF = [{"category": c, "threshold": "BLOCK_NONE"} for c in (
    "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT")]
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key and ENV_FILE.exists():
        m = re.search(r"(?m)^GEMINI_API_KEY=(.+)$", ENV_FILE.read_text())
        key = m.group(1).strip().strip("\"'") if m else ""
    if not key:
        raise SystemExit("Set GEMINI_API_KEY in the environment or in backend/.env")
    return key


def call(model: str, parts: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    """One generateContent call, retrying rate limits (free tier) and transient errors."""
    payload = {"contents": [{"role": "user", "parts": parts}],
               "generationConfig": config, "safetySettings": SAFETY_OFF}
    for attempt in range(8):
        r = httpx.post(API.format(model=model), json=payload, timeout=300,
                       headers={"x-goog-api-key": api_key()})
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 503):
            m = re.search(r'"retryDelay":\s*"(\d+)s"', r.text)
            time.sleep(int(m.group(1)) + 1 if m else min(60, 5 * 2**attempt))
            continue
        raise AudioToSoapError("provider_error", f"gemini_api_http_{r.status_code}")
    raise AudioToSoapError("quota_exceeded", "gemini_api_rate_limited")


def answer(body: dict[str, Any]) -> tuple[str, int, int]:
    """Final text plus prompt and output tokens (thinking tokens are billed as output)."""
    candidates = body.get("candidates") or []
    if not candidates:
        raise AudioToSoapError("no_response", "model returned no candidates")
    finish = candidates[0].get("finishReason", "")
    if finish not in ("STOP", "MAX_TOKENS"):
        raise AudioToSoapError("content_blocked", f"model finished with reason {finish.lower()}")
    parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    usage = body.get("usageMetadata") or {}
    output = usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
    return text, usage.get("promptTokenCount", 0), output


class GeminiApiAudioToSoap:
    """`AudioToSoap` with the production prompt, sent through the Gemini API."""

    PROVIDER_NAME = "gemini-api"

    def __init__(self, model: str) -> None:
        self._model = model

    def process(self, *, audio_bytes: bytes, mime_type: str,
                encounter_date_iso: str) -> AudioToSoapResult:
        body = call(
            self._model,
            [{"inline_data": {"mime_type": mime_type,
                              "data": base64.b64encode(audio_bytes).decode()}},
             {"text": _build_prompt(encounter_date_iso)}],
            {"responseMimeType": "application/json", "temperature": 0.1,
             "maxOutputTokens": 8192},
        )
        text, prompt_tokens, output_tokens = answer(body)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise AudioToSoapError("invalid_json", "model output was not valid JSON") from e
        if not isinstance(data, dict) or "transcript" not in data or "soap" not in data:
            raise AudioToSoapError("invalid_json", "model output missing required keys")
        try:
            soap = SoapNote.model_validate(data["soap"])
        except ValidationError as e:
            raise AudioToSoapError("schema_validation_failed",
                                   "model output did not match SOAP schema") from e
        return AudioToSoapResult(
            transcript=str(data["transcript"]), soap=soap, provider=self.PROVIDER_NAME,
            model_version=self._model, language=str(data.get("language") or "en")[:16],
            prompt_tokens=prompt_tokens, output_tokens=output_tokens)


def ask_json(model: str, prompt: str) -> tuple[dict[str, Any], int, int]:
    """Text-only JSON call, used for the judge."""
    body = call(model, [{"text": prompt}],
                {"responseMimeType": "application/json", "temperature": 0,
                 "maxOutputTokens": 32768})
    text, prompt_tokens, output_tokens = answer(body)
    return json.loads(text), prompt_tokens, output_tokens
