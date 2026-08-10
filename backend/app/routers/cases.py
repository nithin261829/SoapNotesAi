"""Clinical cases — group encounters for one complaint/episode under a patient.

The Record flow uses these: for an existing patient the doctor either starts a
NEW case (fresh letterhead) or follows up an OPEN case (continuation sheet).
"""
from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.deps import ClinicianDep, TenantUserDep
from app.models.case import Case, CaseStatus
from app.models.common import utc_now
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patients/{patient_id}/cases", tags=["cases"])


class CreateCaseRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class PatchCaseRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=160)
    status: Optional[CaseStatus] = None


class CaseResponse(BaseModel):
    id: str
    case: Case


class CaseListResponse(BaseModel):
    cases: list[CaseResponse]


def _patient_ref(db, user, patient_id: str):
    return (
        db.collection("organizations")
        .document(user.org_id)
        .collection("clinics")
        .document(user.active_clinic_id)
        .collection("patients")
        .document(patient_id)
    )


def _case_id(title: str) -> str:
    import re

    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:24] or "case"
    return f"{base}-{secrets.token_hex(3)}"


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CaseResponse)
def create_case(patient_id: str, body: CreateCaseRequest, user: ClinicianDep) -> CaseResponse:
    db = get_db()
    pref = _patient_ref(db, user, patient_id)
    if not pref.get().exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="patient_not_found")
    cid = _case_id(body.title)
    now = utc_now()
    case = Case(
        org_id=user.org_id,
        clinic_id=user.active_clinic_id,
        patient_id=patient_id,
        title=body.title.strip(),
        created_by_uid=user.uid,
        opened_at=now,
        created_at=now,
        updated_at=now,
    )
    pref.collection("cases").document(cid).set(case.model_dump(mode="json"))
    logger.info("case_created id=%s patient=%s", cid, patient_id)
    return CaseResponse(id=cid, case=case)


@router.get("", response_model=CaseListResponse)
def list_cases(
    patient_id: str, user: TenantUserDep, include_closed: bool = False
) -> CaseListResponse:
    db = get_db()
    snaps = (
        _patient_ref(db, user, patient_id)
        .collection("cases")
        .order_by("last_encounter_at", direction="DESCENDING")
        .stream()
    )
    out: list[CaseResponse] = []
    for snap in snaps:
        try:
            case = Case.model_validate(snap.to_dict())
        except Exception:
            continue
        if not include_closed and case.status != "open":
            continue
        out.append(CaseResponse(id=snap.id, case=case))
    if not out and not include_closed:
        # fall back to created_at order when last_encounter_at is unset
        for snap in _patient_ref(db, user, patient_id).collection("cases").stream():
            try:
                case = Case.model_validate(snap.to_dict())
            except Exception:
                continue
            if case.status == "open":
                out.append(CaseResponse(id=snap.id, case=case))
    return CaseListResponse(cases=out)


@router.patch("/{case_id}", response_model=CaseResponse)
def patch_case(
    patient_id: str, case_id: str, body: PatchCaseRequest, user: ClinicianDep
) -> CaseResponse:
    db = get_db()
    ref = _patient_ref(db, user, patient_id).collection("cases").document(case_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")
    patch: dict[str, object] = {"updated_at": utc_now()}
    if body.title is not None:
        patch["title"] = body.title.strip()
    if body.status is not None:
        patch["status"] = body.status
    ref.update(patch)
    return CaseResponse(id=case_id, case=Case.model_validate(ref.get().to_dict()))
