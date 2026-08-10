"""Audio receive + audio → SOAP endpoint with persistence.

The audio is uploaded to Cloud Storage and the Recording doc (with embedded
transcript + SOAP) is written to Firestore under the caller's active clinic.
The mobile keeps a local copy of the audio file as well, but the canonical
copy lives in Storage.
"""
from __future__ import annotations

import logging
import os
import tempfile
import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

import re
import secrets

from app.auth.deps import ClinicianDep
from app.config import Settings, get_settings
from app.interfaces.audio_to_soap import AudioToSoap, AudioToSoapError
from app.models.common import utc_now
from app.models.patient import Patient
from app.models.recording import Recording, TranscriptDoc
from app.models.usage import UsageRecord
from app.models.soap import SoapNote
from app.services import pipeline
from app.services.billing_service import charge_note, check_note_allowance, release_note_slot
from app.services.firestore import get_db
from app.services.storage import upload_audio as upload_audio_to_gcs


def _new_patient_id(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "patient"
    return f"{base}-{secrets.token_hex(3)}"

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audio", tags=["audio"])

ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "audio/m4a",
        "audio/mp4",
        "audio/x-m4a",
        "audio/aac",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "application/octet-stream",
    }
)

CHUNK_SIZE = 64 * 1024


class AudioUploadResponse(BaseModel):
    recording_id: str
    patient_id: str
    patient_name: str
    # True when the patient was auto-created from SOAP demographics (vs. selected).
    patient_created: bool = False
    size_bytes: int
    mime_type: str
    client_duration_ms: int | None = None
    received_at: datetime
    transcript: str
    soap: SoapNote
    # AI provider/model/tokens/cost are recorded server-side in the org's
    # usage collection and are never returned to clients.


# Gemini 2.5 Flash list pricing (update from https://cloud.google.com/vertex-ai/pricing).
# Treats all input tokens at the same rate; audio tokens are billed at this rate too.
_GEMINI_FLASH_INPUT_USD_PER_TOKEN = 0.30 / 1_000_000
_GEMINI_FLASH_OUTPUT_USD_PER_TOKEN = 2.50 / 1_000_000


def _estimate_cost_usd(prompt_tokens: int | None, output_tokens: int | None) -> float | None:
    if prompt_tokens is None and output_tokens is None:
        return None
    inp = (prompt_tokens or 0) * _GEMINI_FLASH_INPUT_USD_PER_TOKEN
    out = (output_tokens or 0) * _GEMINI_FLASH_OUTPUT_USD_PER_TOKEN
    return round(inp + out, 6)


# Imported here to break the circular import (router → main.get_audio_to_soap).
def _get_audio_to_soap() -> AudioToSoap:
    from app.main import get_audio_to_soap

    return get_audio_to_soap()


@router.post(
    "/upload",
    status_code=status.HTTP_201_CREATED,
    response_model=AudioUploadResponse,
    summary="Receive audio, transcribe + structure, persist under patient",
    description=(
        "Multipart form upload. Streams the file to a temp path, runs the "
        "active AudioToSoap provider, uploads the audio to Cloud Storage at "
        "organizations/{orgId}/clinics/{clinicId}/patients/{patientId}/"
        "recordings/{recordingId}/audio.m4a, writes the Recording Firestore "
        "doc (with embedded transcript + SOAP), and returns the result."
    ),
)
async def upload_audio(
    audio: Annotated[UploadFile, File(description="Audio file (m4a/mp4/wav/mp3/webm).")],
    user: ClinicianDep,
    patient_id: Annotated[
        str | None,
        Form(
            description=(
                "Existing patient ID. Omit for a 'new patient' encounter — the "
                "patient will be auto-created from demographics in the audio."
            ),
        ),
    ] = None,
    client_duration_ms: Annotated[int | None, Form()] = None,
    encounter_date: Annotated[str | None, Form()] = None,
    case_id: Annotated[
        str | None,
        Form(description="Existing case to follow up (continuation sheet). Omit to start a new case."),
    ] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
    audio_to_soap: Annotated[AudioToSoap, Depends(_get_audio_to_soap)] = None,  # type: ignore[assignment]
) -> AudioUploadResponse:
    content_type = (audio.content_type or "application/octet-stream").lower()
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_audio_format",
        )

    if (
        client_duration_ms is not None
        and client_duration_ms > settings.max_audio_duration_ms
    ):
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="audio_too_long",
        )

    # Default the encounter date to today's UTC date if the client didn't pass one.
    if encounter_date:
        try:
            date.fromisoformat(encounter_date[:10])
            encounter_date_iso = encounter_date
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid_encounter_date",
            ) from e
    else:
        encounter_date_iso = utc_now().date().isoformat()

    fd, tmp_path = tempfile.mkstemp(suffix=".m4a", prefix="soapnotesai-")
    bytes_written = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await audio.read(CHUNK_SIZE)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail="audio_too_large",
                    )
                out.write(chunk)

        if bytes_written == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="empty_audio",
            )

        # If the caller picked an existing patient, verify they exist under
        # the active clinic before we spend money on the AI call. For "new
        # patient" mode we wait until after the AI call so we can use the
        # extracted demographics.
        db = get_db()
        patients_col = (
            db.collection("organizations")
            .document(user.org_id)
            .collection("clinics")
            .document(user.active_clinic_id)
            .collection("patients")
        )
        if patient_id:
            existing_snap = patients_col.document(patient_id).get()
            if not existing_snap.exists:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="patient_not_found"
                )

        # Billing gate BEFORE the AI call so refused requests cost nothing.
        # Per-clinic billing; with app_config/billing.enforce=false this only logs.
        allowance = check_note_allowance(user.org_id, user.active_clinic_id)

        recording_id = str(uuid.uuid4())

        # Run the audio → SOAP pipeline. The provider reads the audio bytes,
        # so we slurp them in here.
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()

        try:
            result = pipeline.audio_to_soap(
                provider=audio_to_soap,
                audio_bytes=audio_bytes,
                mime_type=content_type,
                encounter_date_iso=encounter_date_iso,
            )
        except AudioToSoapError as e:
            logger.warning(
                "audio_to_soap_failed id=%s code=%s",  # no PHI
                recording_id,
                e.code,
            )
            # The note never happened — give back the reserved daily slot.
            release_note_slot(user.org_id, allowance)
            raise HTTPException(
                status_code=_status_for_provider_error(e.code),
                detail=e.code,
            ) from e

        # Resolve the target patient. If the caller didn't pick one, auto-create
        # from the SOAP demographics that the AI just extracted.
        patient_created = False
        if not patient_id:
            extracted_name = (result.soap.patient.name or "").strip()
            if not extracted_name:
                # No name in the audio — fall back to a timestamped placeholder
                # so the recording still saves. Doctor can rename in the
                # Patients tab.
                extracted_name = f"Patient {utc_now().strftime('%b %d, %H:%M')}"
            # Disambiguate: if a patient with this exact name already exists in
            # this clinic, append the encounter timestamp so the list shows
            # them as separate records (e.g. two "John Smith"s in one day).
            display_name = extracted_name
            collision_snap = list(
                patients_col.where("name", "==", extracted_name).limit(1).stream()
            )
            if collision_snap:
                display_name = f"{extracted_name} ({utc_now().strftime('%b %d, %H:%M')})"

            new_pid = _new_patient_id(extracted_name)
            new_patient = Patient(
                org_id=user.org_id,
                clinic_id=user.active_clinic_id,
                name=display_name,
                age_at_record=result.soap.patient.age,
                age_recorded_at=utc_now() if result.soap.patient.age is not None else None,
                sex=result.soap.patient.sex,
                created_by_uid=user.uid,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            patients_col.document(new_pid).set(new_patient.model_dump(mode="json"))
            patient_id = new_pid
            patient_name = display_name
            patient_created = True
        else:
            existing_data = patients_col.document(patient_id).get().to_dict() or {}
            patient_name = (existing_data.get("name") or "").strip() or patient_id

        # Persist: upload audio to Storage, then write the Recording doc.
        # If the Storage upload fails we surface a 502 rather than write a
        # Recording doc with a phantom path.
        try:
            gs_uri = upload_audio_to_gcs(
                org_id=user.org_id,
                clinic_id=user.active_clinic_id,
                patient_id=patient_id,
                recording_id=recording_id,
                audio_bytes=audio_bytes,
                content_type=content_type,
            )
        except Exception as e:
            logger.exception("audio_storage_upload_failed")
            release_note_slot(user.org_id, allowance)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail="storage_upload_failed"
            ) from e

        patient_ref = patients_col.document(patient_id)
        now = utc_now()

        # Resolve the case. Follow-up → use the given open case. Otherwise start
        # a new case titled from the chief complaint. The first recording in a
        # case prints on letterhead; later ones on continuation sheets.
        cases_col = patient_ref.collection("cases")
        resolved_case_id = case_id
        if case_id:
            case_snap = cases_col.document(case_id).get()
            if not case_snap.exists:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found"
                )
        else:
            from app.models.case import Case as CaseModel

            title = (result.soap.subjective.chief_complaint or "").strip() if result.soap.subjective else ""
            if not title:
                title = f"Case {now.strftime('%b %d, %Y')}"
            resolved_case_id = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:24] or "case"
            resolved_case_id = f"{resolved_case_id}-{secrets.token_hex(3)}"
            cases_col.document(resolved_case_id).set(
                CaseModel(
                    org_id=user.org_id,
                    clinic_id=user.active_clinic_id,
                    patient_id=patient_id,
                    title=title[:160],
                    created_by_uid=user.uid,
                    opened_at=now,
                    created_at=now,
                    updated_at=now,
                ).model_dump(mode="json")
            )

        transcript_doc = TranscriptDoc(text=result.transcript, language=result.language)
        est_cost = _estimate_cost_usd(result.prompt_tokens, result.output_tokens)
        # Provenance stays server-side: clients can read the Recording doc via
        # Firestore rules, so scrub AI metadata from the embedded SOAP before
        # persisting and record it in the usage collection instead.
        clean_soap = result.soap.model_copy(
            update={"llm_provider": None, "llm_model_version": None}
        )
        recording = Recording(
            org_id=user.org_id,
            clinic_id=user.active_clinic_id,
            patient_id=patient_id,
            case_id=resolved_case_id,
            audio_storage_path=gs_uri,
            mime_type=content_type,
            duration_seconds=(client_duration_ms / 1000.0) if client_duration_ms else None,
            size_bytes=bytes_written,
            created_by_uid=user.uid,
            created_at=now,
            updated_at=now,
            status="completed",
            transcript=transcript_doc,
            soap=clean_soap,
        )
        patient_ref.collection("recordings").document(recording_id).set(
            recording.model_dump(mode="json")
        )
        # Backend-only usage/cost accounting — denied to clients by rules.
        usage = UsageRecord(
            org_id=user.org_id,
            clinic_id=user.active_clinic_id,
            patient_id=patient_id,
            recording_id=recording_id,
            created_by_uid=user.uid,
            created_at=now,
            ai_provider=result.provider,
            ai_model_version=result.model_version,
            prompt_tokens=result.prompt_tokens,
            output_tokens=result.output_tokens,
            estimated_cost_usd=est_cost,
        )
        (
            db.collection("organizations")
            .document(user.org_id)
            .collection("usage")
            .document(recording_id)
            .set(usage.model_dump(mode="json"))
        )
        # Bump last-encounter sort key + denormalized recording count.
        from google.cloud.firestore_v1 import Increment

        patient_ref.update(
            {
                "last_encounter_at": now,
                "updated_at": now,
                "recording_count": Increment(1),
            }
        )
        cases_col.document(resolved_case_id).update(
            {
                "encounter_count": Increment(1),
                "last_encounter_at": now,
                "updated_at": now,
            }
        )

        # Debit the wallet for payg notes (no-op for free tiers / enforce off).
        charge_note(user.org_id, user.uid, recording_id, allowance)

        logger.info(
            "audio_processed id=%s bytes=%d mime=%s patient=%s",
            recording_id,
            bytes_written,
            content_type,
            patient_id,
        )

        return AudioUploadResponse(
            recording_id=recording_id,
            patient_id=patient_id,
            patient_name=patient_name,
            patient_created=patient_created,
            size_bytes=bytes_written,
            mime_type=content_type,
            client_duration_ms=client_duration_ms,
            received_at=now,
            transcript=result.transcript,
            soap=clean_soap,
        )
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError as e:
                logger.warning("failed to cleanup temp file %s: %s", tmp_path, e)


_PROVIDER_ERROR_STATUS = {
    "not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
    "provider_error": status.HTTP_502_BAD_GATEWAY,
    "no_response": status.HTTP_502_BAD_GATEWAY,
    "content_blocked": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "invalid_json": status.HTTP_502_BAD_GATEWAY,
    "schema_validation_failed": status.HTTP_502_BAD_GATEWAY,
    "quota_exceeded": status.HTTP_429_TOO_MANY_REQUESTS,
}


def _status_for_provider_error(code: str) -> int:
    return _PROVIDER_ERROR_STATUS.get(code, status.HTTP_502_BAD_GATEWAY)
