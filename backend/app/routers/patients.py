"""Patients under the caller's active clinic."""
from __future__ import annotations

import logging
import secrets
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.deps import ClinicianDep, TenantUserDep
from app.models.common import utc_now
from app.models.patient import Patient, Sex
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patients", tags=["patients"])


class CreatePatientRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    date_of_birth: Optional[date] = None
    age_at_record: Optional[int] = Field(None, ge=0, le=130)
    sex: Optional[Sex] = None
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=120)
    address: Optional[str] = Field(None, max_length=300)


class PatientResponse(BaseModel):
    id: str
    patient: Patient


class PatientListResponse(BaseModel):
    patients: list[PatientResponse]


def _patient_id(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "patient"
    return f"{base}-{secrets.token_hex(3)}"


def _clinic_ref(db, org_id: str, clinic_id: str):
    return db.collection("organizations").document(org_id).collection("clinics").document(clinic_id)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=PatientResponse)
def create_patient(body: CreatePatientRequest, user: ClinicianDep) -> PatientResponse:
    db = get_db()
    pid = _patient_id(body.name)
    now = utc_now()
    patient = Patient(
        org_id=user.org_id,  # type: ignore[arg-type]
        clinic_id=user.active_clinic_id,  # type: ignore[arg-type]
        name=body.name,
        date_of_birth=body.date_of_birth,
        age_at_record=body.age_at_record,
        age_recorded_at=now if body.age_at_record is not None else None,
        sex=body.sex,
        phone=body.phone,
        email=body.email,
        address=body.address,
        created_by_uid=user.uid,
        created_at=now,
        updated_at=now,
    )
    _clinic_ref(db, user.org_id, user.active_clinic_id).collection("patients").document(pid).set(
        patient.model_dump(mode="json")
    )
    logger.info("patient_created id=%s clinic=%s by=%s", pid, user.active_clinic_id, user.uid)
    return PatientResponse(id=pid, patient=patient)


@router.get("", response_model=PatientListResponse)
def list_patients(user: TenantUserDep) -> PatientListResponse:
    db = get_db()
    snaps = (
        _clinic_ref(db, user.org_id, user.active_clinic_id)
        .collection("patients")
        .order_by("last_encounter_at", direction="DESCENDING")
        .stream()
    )
    out: list[PatientResponse] = []
    for snap in snaps:
        try:
            patient = Patient.model_validate(snap.to_dict())
        except Exception:
            logger.warning("skipping_invalid_patient_doc id=%s", snap.id)
            continue
        out.append(PatientResponse(id=snap.id, patient=patient))
    # Fall back to created_at sort if last_encounter_at orderBy excluded too many.
    if not out:
        snaps2 = (
            _clinic_ref(db, user.org_id, user.active_clinic_id)
            .collection("patients")
            .order_by("created_at", direction="DESCENDING")
            .stream()
        )
        for snap in snaps2:
            try:
                patient = Patient.model_validate(snap.to_dict())
            except Exception:
                continue
            out.append(PatientResponse(id=snap.id, patient=patient))
    return PatientListResponse(patients=out)


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: str, user: TenantUserDep) -> PatientResponse:
    db = get_db()
    snap = (
        _clinic_ref(db, user.org_id, user.active_clinic_id)
        .collection("patients")
        .document(patient_id)
        .get()
    )
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="patient_not_found")
    return PatientResponse(id=snap.id, patient=Patient.model_validate(snap.to_dict()))


class PatchPatientRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    age_at_record: Optional[int] = Field(None, ge=0, le=130)
    sex: Optional[Sex] = None
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=120)
    address: Optional[str] = Field(None, max_length=300)


@router.patch("/{patient_id}", response_model=PatientResponse)
def patch_patient(
    patient_id: str, body: PatchPatientRequest, user: ClinicianDep
) -> PatientResponse:
    db = get_db()
    ref = (
        _clinic_ref(db, user.org_id, user.active_clinic_id)
        .collection("patients")
        .document(patient_id)
    )
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="patient_not_found")

    patch: dict[str, object] = {"updated_at": utc_now()}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.age_at_record is not None:
        patch["age_at_record"] = body.age_at_record
        patch["age_recorded_at"] = utc_now()
    if body.sex is not None:
        patch["sex"] = body.sex
    if body.phone is not None:
        patch["phone"] = body.phone.strip()
    if body.email is not None:
        patch["email"] = body.email.strip()
    if body.address is not None:
        patch["address"] = body.address.strip()
    ref.update(patch)

    updated = Patient.model_validate(ref.get().to_dict())
    logger.info("patient_edited id=%s by=%s", patient_id, user.uid)
    return PatientResponse(id=patient_id, patient=updated)
