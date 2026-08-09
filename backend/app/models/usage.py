"""AI usage + cost accounting, kept server-side only.

Located at organizations/{orgId}/usage/{recordingId}. Firestore rules deny all
client access to this collection — cost data must never reach the app. The
mirror fields that used to live on the client-readable Recording doc were
removed for the same reason.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now


class UsageRecord(FirestoreModel):
    org_id: str
    clinic_id: str
    patient_id: str
    recording_id: str
    created_by_uid: str
    created_at: datetime = Field(default_factory=utc_now)

    ai_provider: Optional[str] = None
    ai_model_version: Optional[str] = None
    prompt_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    estimated_cost_usd: Optional[float] = None
