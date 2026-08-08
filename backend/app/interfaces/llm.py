from __future__ import annotations

from typing import Protocol

from app.models.soap import SoapNote


class SoapStructurer(Protocol):
    """Transcript → validated SOAP note. Default impl: Gemini via Vertex AI.

    The implementation MUST:
      - Request structured JSON output matching the `SoapNote` schema.
      - Validate the model output via the Pydantic schema before returning.
      - Never fabricate clinical content. Fields not present in the transcript must remain empty.
    """

    def structure(self, *, transcript: str, encounter_date_iso: str) -> SoapNote:
        """Return a validated SoapNote built strictly from `transcript`."""
        ...
