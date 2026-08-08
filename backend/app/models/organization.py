"""Top-level tenant: an Organization owns one or more Clinics."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import EmailStr, Field

from app.models.common import FirestoreModel, utc_now


class Organization(FirestoreModel):
    """Located at organizations/{orgId}.

    A solo practice has exactly one clinic under it; a health-system has many.
    """
    name: str
    billing_email: Optional[EmailStr] = None
    owner_uid: str  # the user who created the org; has implicit owner role on all clinics
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
