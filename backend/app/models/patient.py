from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now

Sex = Literal["male", "female", "other", "unknown"]


class Patient(FirestoreModel):
    """Located at organizations/{orgId}/clinics/{clinicId}/patients/{patientId}.

    `org_id` and `clinic_id` are denormalized into the doc for collectionGroup
    queries (e.g. "all my patients across both clinics").
    """
    org_id: str
    clinic_id: str
    name: str
    date_of_birth: Optional[date] = None
    # If DOB isn't known, the doctor / LLM may record an age snapshot instead.
    age_at_record: Optional[int] = None
    age_recorded_at: Optional[datetime] = None
    sex: Optional[Sex] = None
    # For one-tap call/message from follow-up reminders.
    phone: Optional[str] = None
    created_by_uid: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    # Denormalized for the patients-list sort + chip counter.
    last_encounter_at: Optional[datetime] = None
    recording_count: int = 0
