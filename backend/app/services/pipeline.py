"""Pipeline service — orchestrates audio → transcript + structured SOAP.

Currently a thin wrapper over the active `AudioToSoap` provider. Will grow as
later build steps add PDF rendering (step 8) and Firestore persistence (step 9).
"""
from __future__ import annotations

from app.interfaces.audio_to_soap import AudioToSoap, AudioToSoapResult


def audio_to_soap(
    *,
    provider: AudioToSoap,
    audio_bytes: bytes,
    mime_type: str,
    encounter_date_iso: str,
) -> AudioToSoapResult:
    return provider.process(
        audio_bytes=audio_bytes,
        mime_type=mime_type,
        encounter_date_iso=encounter_date_iso,
    )
