from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now


class ClinicLetterhead(FirestoreModel):
    """Header information rendered on every PDF."""
    name: str
    address_lines: list[str] = Field(default_factory=list)
    phone: Optional[str] = None
    logo_storage_path: Optional[str] = None  # gs:// path; resolved to signed URL at render time


class Clinic(FirestoreModel):
    """Located at organizations/{orgId}/clinics/{clinicId}.

    `org_id` is denormalized into the doc so we can run collectionGroup queries
    across all clinics in an org without traversing parents.
    """
    org_id: str
    name: str
    letterhead: ClinicLetterhead
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
