"""Audit log. Intentionally narrow — must NEVER contain PHI."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now

AuditAction = Literal["create", "view", "edit", "delete", "sign", "export"]
AuditTargetType = Literal["patient", "recording", "soap", "pdf", "doctor"]


class AuditTarget(FirestoreModel):
    type: AuditTargetType
    id: str
    # Parent IDs help reconstruct the path without leaking names.
    patient_id: Optional[str] = None
    recording_id: Optional[str] = None


class AuditClientMeta(FirestoreModel):
    platform: Optional[str] = None       # e.g. "ios", "android", "web"
    app_version: Optional[str] = None
    # Do NOT add user-agent or IP here unless legal review approves it under your privacy policy.


class AuditEvent(FirestoreModel):
    """Located at organizations/{orgId}/clinics/{clinicId}/audit/{eventId}.

    Identifiers only — no transcripts, no patient names, no clinical content.
    """
    org_id: str
    clinic_id: str
    actor_uid: str
    action: AuditAction
    target: AuditTarget
    ts: datetime = Field(default_factory=utc_now)
    client: Optional[AuditClientMeta] = None
