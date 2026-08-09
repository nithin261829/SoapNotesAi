from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now
from app.models.soap import SoapNote

RecordingStatus = Literal[
    "uploaded",
    "transcribing",
    "transcribed",
    "structuring",
    "structured",
    "completed",
    "failed",
]


class TranscriptWord(FirestoreModel):
    w: str
    start: float
    end: float


class TranscriptDoc(FirestoreModel):
    """Inline transcript stored on the recording. If it ever exceeds Firestore's
    1 MiB doc limit, swap to a Storage pointer — until then inline keeps things simple.
    """
    text: str
    language: str = "en"
    words: list[TranscriptWord] = Field(default_factory=list)


class RecordingError(FirestoreModel):
    """Carries enough to debug but NO PHI (no transcript / patient name / clinical content)."""
    step: Literal["upload", "transcribe", "structure"]
    code: str
    message: str


class Recording(FirestoreModel):
    """Located at organizations/{orgId}/clinics/{clinicId}/patients/{patientId}/recordings/{recordingId}.

    SOAP is embedded inline (not a subcollection) — keeps reads to one doc and
    lets the doctor edit + re-save without extra round trips. Edits stamp
    `edited_by_doctor=True` on the embedded SoapNote.
    """
    org_id: str
    clinic_id: str
    patient_id: str
    audio_storage_path: str           # gs:// path
    mime_type: str = "audio/m4a"
    duration_seconds: Optional[float] = None
    size_bytes: Optional[int] = None
    created_by_uid: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    status: RecordingStatus = "uploaded"
    transcript: Optional[TranscriptDoc] = None
    soap: Optional[SoapNote] = None
    # AI provider/model/token/cost data lives in organizations/{orgId}/usage —
    # clients can read Recording docs directly, so nothing billing-related may
    # appear here.
    error: Optional[RecordingError] = None
