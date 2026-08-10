"""A clinical case: a group of encounters around one complaint/episode.

Located at organizations/{orgId}/clinics/{clinicId}/patients/{patientId}/cases/{caseId}.
Recordings carry `case_id` linking them to their case. The FIRST recording in a
case prints on the branded letterhead; follow-up recordings print on plain
continuation sheets (only the new note, not the whole history).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now

CaseStatus = Literal["open", "closed"]


class Case(FirestoreModel):
    org_id: str
    clinic_id: str
    patient_id: str
    title: str                       # e.g. the chief complaint of the first visit
    status: CaseStatus = "open"
    encounter_count: int = 0         # recordings attached to this case
    opened_at: datetime = Field(default_factory=utc_now)
    last_encounter_at: Optional[datetime] = None
    created_by_uid: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
