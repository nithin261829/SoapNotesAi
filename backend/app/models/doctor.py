from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import EmailStr, Field

from app.models.common import FirestoreModel, utc_now

DoctorRole = Literal["owner", "doctor"]


class Doctor(FirestoreModel):
    """Located at clinics/{clinicId}/doctors/{doctorUid}.

    The Firestore document ID equals the Firebase Auth uid.
    The `role` and `clinic_id` are also set as Firebase custom claims for rule checks.
    """
    display_name: str
    credentials: Optional[str] = None  # e.g. "MD", "DO", "NP"
    license_number: Optional[str] = None
    email: EmailStr
    role: DoctorRole = "doctor"
    profile_photo_storage_path: Optional[str] = None
    signature_storage_path: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
