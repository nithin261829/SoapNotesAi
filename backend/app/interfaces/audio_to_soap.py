"""Audio → (transcript, structured SOAP) interface.

Combines what would otherwise be STT + LLM structuring steps. Vertex AI Gemini
2.5 is multimodal and can do both in a single call; this interface keeps the
swap point open in case a future deployment splits them again.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.models.soap import SoapNote


class AudioToSoapError(Exception):
    """Raised by providers when audio → SOAP fails in a known way."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AudioToSoapResult:
    transcript: str
    soap: SoapNote
    provider: str
    model_version: str
    # Token usage reported by the provider, used to compute cost on the client.
    # None when the provider doesn't expose usage (e.g. fake provider).
    prompt_tokens: int | None = None
    output_tokens: int | None = None


class AudioToSoap(Protocol):
    """Take an audio recording and return both a verbatim transcript and a
    validated SOAP note. Default impl: Vertex AI Gemini multimodal.

    Implementations MUST:
      - Extract only what is present in the audio. Never invent clinical content.
      - Validate the structured output against `SoapNote` before returning.
      - Raise `AudioToSoapError` with a stable code on known failure modes
        (no_response, content_blocked, invalid_json, schema_validation_failed,
        quota_exceeded, provider_error).
      - Never include PHI in raised error messages or exception strings.
    """

    def process(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        encounter_date_iso: str,
    ) -> AudioToSoapResult: ...
