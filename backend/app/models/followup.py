"""Patient follow-up scheduling, powering in-app lists and push reminders.

Located at organizations/{orgId}/followups/{followupId} (org-level, not under
the patient, so the daily reminder sweep is one query per org). Patient name +
phone are denormalized for one-tap call/message from a reminder.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now

FollowupStatus = Literal["scheduled", "done", "cancelled"]


class Followup(FirestoreModel):
    org_id: str
    clinic_id: str
    patient_id: str
    patient_name: str
    patient_phone: Optional[str] = None
    recording_id: Optional[str] = None  # encounter that triggered this follow-up
    due_date: str  # ISO date YYYY-MM-DD (clinic-local intent, no tz gymnastics)
    note: Optional[str] = None  # e.g. "review BP", "suture removal"
    status: FollowupStatus = "scheduled"
    # Stamped by the reminder runner so each follow-up alerts at most once
    # per day-before/day-of window.
    reminded_on: list[str] = Field(default_factory=list)
    created_by_uid: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
