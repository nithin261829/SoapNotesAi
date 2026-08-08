"""Invite codes — owner-only. Single-use, 14-day default expiry."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.deps import OwnerDep
from app.models.common import utc_now
from app.models.user_profile import ClinicRole
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invites", tags=["invites"])


class CreateInviteRequest(BaseModel):
    clinic_id: str = Field(min_length=1)
    role: ClinicRole = "doctor"
    expires_in_hours: int = Field(24 * 14, ge=1, le=24 * 90)


class InviteResponse(BaseModel):
    code: str
    org_id: str
    clinic_id: str
    role: ClinicRole
    expires_at: datetime
    used_at: Optional[datetime] = None


@router.post("", status_code=status.HTTP_201_CREATED, response_model=InviteResponse)
def create_invite(body: CreateInviteRequest, owner: OwnerDep) -> InviteResponse:
    db = get_db()

    clinic_snap = (
        db.collection("organizations")
        .document(owner.org_id)
        .collection("clinics")
        .document(body.clinic_id)
        .get()
    )
    if not clinic_snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="clinic_not_found")

    # 16-char URL-safe code → ~96 bits of entropy. Top-level collection so the
    # joiner endpoint can find it without knowing the org first.
    code = secrets.token_urlsafe(12)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours)

    db.collection("invites").document(code).set(
        {
            "org_id": owner.org_id,
            "clinic_id": body.clinic_id,
            "role": body.role,
            "created_by_uid": owner.uid,
            "created_at": utc_now(),
            "expires_at": expires_at,
            "used_at": None,
            "used_by_uid": None,
        }
    )

    logger.info(
        "invite_created code=%s org=%s clinic=%s role=%s by=%s",
        code,
        owner.org_id,
        body.clinic_id,
        body.role,
        owner.uid,
    )
    return InviteResponse(
        code=code,
        org_id=owner.org_id,
        clinic_id=body.clinic_id,
        role=body.role,
        expires_at=expires_at,
    )
