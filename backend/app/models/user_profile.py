"""Global user profile.

Lives at users/{uid} where uid = Firebase Auth uid. Holds the user's org +
clinic memberships so the mobile knows which clinics to show in the switcher.
The currently active clinic is mirrored into custom claims for rules checks.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import EmailStr, Field

from app.models.common import FirestoreModel, utc_now

ClinicRole = Literal["owner", "admin", "doctor", "viewer"]


class ClinicMembership(FirestoreModel):
    clinic_id: str
    role: ClinicRole
    joined_at: datetime = Field(default_factory=utc_now)


class UserProfile(FirestoreModel):
    """Located at users/{uid}.

    Custom claims on the user's ID token mirror `org_id` and `active_clinic_id`
    (and `role` for the active clinic) so Firestore + Storage rules can enforce
    tenancy without an extra read.
    """
    # Either email or phone identifies the account (phone-OTP users have no
    # email); at least one is always present.
    email: Optional[EmailStr] = None
    display_name: Optional[str] = None
    credentials: Optional[str] = None
    # Permanent unique doctor registration id (e.g. "SNA-00042"), assigned
    # once at signup from the global counter. Printed on PDFs and shown in
    # the profile; never reused or reassigned.
    registration_id: Optional[str] = None
    # Registered phone for OTP delivery + SMS alerts.
    phone: Optional[str] = None
    org_id: str
    default_clinic_id: Optional[str] = None
    memberships: list[ClinicMembership] = Field(default_factory=list)
    reminders_enabled: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
