from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now


class ClinicLetterhead(FirestoreModel):
    """Header information rendered on every PDF. The logo is embedded into the
    PDF as base64 at render time (never linked), so it always displays."""
    name: str
    address_lines: list[str] = Field(default_factory=list)
    phone: Optional[str] = None
    email: Optional[str] = None
    tagline: Optional[str] = None
    logo_storage_path: Optional[str] = None  # gs:// path; bytes inlined at render time


class Clinic(FirestoreModel):
    """Located at organizations/{orgId}/clinics/{clinicId}.

    `org_id` is denormalized into the doc so we can run collectionGroup queries
    across all clinics in an org without traversing parents.
    """
    org_id: str
    name: str
    letterhead: ClinicLetterhead
    # Paid letterhead changes (product rule): the first setup is free (covered
    # by the joining fee); each later change debits a service fee from the
    # org wallet. This counter is the "was it free already?" source of truth.
    letterhead_change_count: int = 0
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
