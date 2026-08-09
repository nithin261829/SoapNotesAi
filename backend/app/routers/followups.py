"""Follow-up CRUD for clinic staff + doctors.

Reminder pushes for these are sent by the scheduler-invoked runner in
routers/internal.py (Standard/Premium tiers only, per the product matrix).
"""
from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.deps import TenantUserDep
from app.models.common import utc_now
from app.models.followup import Followup, FollowupStatus
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/followups", tags=["followups"])


class CreateFollowupRequest(BaseModel):
    patient_id: str = Field(min_length=1)
    due_date: str  # YYYY-MM-DD
    note: Optional[str] = Field(None, max_length=300)
    recording_id: Optional[str] = None


class PatchFollowupRequest(BaseModel):
    due_date: Optional[str] = None
    note: Optional[str] = Field(None, max_length=300)
    status: Optional[FollowupStatus] = None


class FollowupResponse(BaseModel):
    id: str
    followup: Followup


class FollowupListResponse(BaseModel):
    followups: list[FollowupResponse]


def _followups_col(db, org_id: str):
    return db.collection("organizations").document(org_id).collection("followups")


def _validate_date(s: str) -> str:
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_due_date"
        ) from e


@router.post("", status_code=status.HTTP_201_CREATED, response_model=FollowupResponse)
def create_followup(body: CreateFollowupRequest, user: TenantUserDep) -> FollowupResponse:
    db = get_db()
    due = _validate_date(body.due_date)

    patient_snap = (
        db.collection("organizations")
        .document(user.org_id)
        .collection("clinics")
        .document(user.active_clinic_id)
        .collection("patients")
        .document(body.patient_id)
        .get()
    )
    if not patient_snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="patient_not_found")
    pdata = patient_snap.to_dict() or {}

    fid = str(uuid.uuid4())
    followup = Followup(
        org_id=user.org_id,
        clinic_id=user.active_clinic_id,
        patient_id=body.patient_id,
        patient_name=pdata.get("name") or body.patient_id,
        patient_phone=pdata.get("phone"),
        recording_id=body.recording_id,
        due_date=due,
        note=body.note,
        created_by_uid=user.uid,
    )
    _followups_col(db, user.org_id).document(fid).set(followup.model_dump(mode="json"))
    logger.info("followup_created id=%s patient=%s due=%s", fid, body.patient_id, due)
    return FollowupResponse(id=fid, followup=followup)


@router.get("", response_model=FollowupListResponse)
def list_followups(
    user: TenantUserDep,
    patient_id: Optional[str] = None,
    include_closed: bool = False,
) -> FollowupListResponse:
    db = get_db()
    q = _followups_col(db, user.org_id).where("clinic_id", "==", user.active_clinic_id)
    if patient_id:
        q = q.where("patient_id", "==", patient_id)
    out: list[FollowupResponse] = []
    for snap in q.stream():
        try:
            f = Followup.model_validate(snap.to_dict())
        except Exception:
            logger.warning("skipping_invalid_followup id=%s", snap.id)
            continue
        if not include_closed and f.status != "scheduled":
            continue
        out.append(FollowupResponse(id=snap.id, followup=f))
    out.sort(key=lambda r: r.followup.due_date)
    return FollowupListResponse(followups=out)


@router.patch("/{followup_id}", response_model=FollowupResponse)
def patch_followup(
    followup_id: str, body: PatchFollowupRequest, user: TenantUserDep
) -> FollowupResponse:
    db = get_db()
    ref = _followups_col(db, user.org_id).document(followup_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="followup_not_found")
    existing = Followup.model_validate(snap.to_dict())
    if existing.clinic_id != user.active_clinic_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="followup_not_found")

    patch: dict[str, object] = {"updated_at": utc_now().isoformat()}
    if body.due_date is not None:
        patch["due_date"] = _validate_date(body.due_date)
        patch["reminded_on"] = []  # re-arm reminders for the new date
    if body.note is not None:
        patch["note"] = body.note
    if body.status is not None:
        patch["status"] = body.status
    ref.update(patch)

    updated = Followup.model_validate(ref.get().to_dict())
    return FollowupResponse(id=followup_id, followup=updated)
