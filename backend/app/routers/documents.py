"""Patient document uploads (lab reports, scans, past records).

Files are streamed to a temp file (size-capped) and uploaded to the default
Storage bucket under
`organizations/{org}/clinics/{clinic}/patients/{pid}/documents/{docId}/{filename}`
so storage.rules tenancy prefixes apply. Metadata lives in Firestore at
`organizations/{org}/clinics/{clinic}/patients/{pid}/documents/{docId}`.

Clinicians (owner/admin/doctor) upload and delete; any tenant user — including
staff, who may need to view/print for the doctor — can list and download via
short-lived signed URLs.
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth.deps import ClinicianDep, TenantUserDep
from app.models.document import PatientDocument
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patients/{patient_id}/documents", tags=["documents"])

ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
}

MAX_DOCUMENT_BYTES = 20 * 1024 * 1024  # 20 MB
CHUNK_SIZE = 64 * 1024
MAX_LABEL_LEN = 120


# ─── Shapes ────────────────────────────────────────────────────────


class DocumentResponse(BaseModel):
    id: str
    document: PatientDocument


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]


class DownloadUrlResponse(BaseModel):
    url: str
    expires_in_seconds: int
    filename: str
    content_type: str


# ─── Helpers ───────────────────────────────────────────────────────


def _patient_ref(db, org_id: str, clinic_id: str, patient_id: str):
    return (
        db.collection("organizations")
        .document(org_id)
        .collection("clinics")
        .document(clinic_id)
        .collection("patients")
        .document(patient_id)
    )


def _require_patient(db, user, patient_id: str):
    """404 unless the patient exists in the caller's active clinic."""
    ref = _patient_ref(db, user.org_id, user.active_clinic_id, patient_id)
    if not ref.get().exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="patient_not_found"
        )
    return ref


def _sanitize_filename(raw: Optional[str], extension: str) -> str:
    """Keep only [a-zA-Z0-9._-], cap at 80 chars, never return an empty name."""
    name = os.path.basename(raw or "").strip()
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
    if not name or set(name) <= {".", "_", "-"}:
        name = f"document.{extension}"
    if len(name) > 80:
        root, dot, ext = name.rpartition(".")
        if dot and root and len(ext) <= 10:
            name = root[: 80 - len(ext) - 1] + "." + ext
        else:
            name = name[:80]
    return name


# ─── Endpoints ─────────────────────────────────────────────────────


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=DocumentResponse,
    summary="Upload a patient document (PDF, JPEG, or PNG; max 20 MB)",
)
async def upload_document(
    patient_id: str,
    user: ClinicianDep,
    file: Annotated[
        UploadFile, File(description="Document file (PDF, JPEG, or PNG; max 20 MB).")
    ],
    label: Annotated[
        Optional[str], Form(description='Optional label, e.g. "Blood report Mar 2026".')
    ] = None,
) -> DocumentResponse:
    content_type = (file.content_type or "").lower()
    extension = ALLOWED_MIME_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_document_format",
        )

    db = get_db()
    patient_ref = _require_patient(db, user, patient_id)

    clean_label = (label or "").strip()[:MAX_LABEL_LEN] or None
    safe_name = _sanitize_filename(file.filename, extension)
    doc_id = str(uuid.uuid4())

    # Stream to a temp file so an oversized upload never sits in memory
    # (same pattern as app/routers/verification.py).
    fd, tmp_path = tempfile.mkstemp(suffix=f".{extension}", prefix="soapnotesai-doc-")
    try:
        bytes_written = 0
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_DOCUMENT_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail="document_too_large",
                    )
                out.write(chunk)

        if bytes_written == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="empty_document"
            )

        try:
            from firebase_admin import storage

            bucket = storage.bucket()
            path = (
                f"organizations/{user.org_id}/clinics/{user.active_clinic_id}/"
                f"patients/{patient_id}/documents/{doc_id}/{safe_name}"
            )
            blob = bucket.blob(path)
            blob.upload_from_filename(tmp_path, content_type=content_type)
            gs_uri = f"gs://{bucket.name}/{path}"
        except Exception as e:
            logger.exception("document_upload_failed patient=%s", patient_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail="storage_upload_failed"
            ) from e
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError as e:
                logger.warning("failed to cleanup temp file %s: %s", tmp_path, e)

    document = PatientDocument(
        org_id=user.org_id,
        clinic_id=user.active_clinic_id,
        patient_id=patient_id,
        filename=safe_name,
        content_type=content_type,
        size_bytes=bytes_written,
        storage_path=gs_uri,
        label=clean_label,
        uploaded_by_uid=user.uid,
    )
    patient_ref.collection("documents").document(doc_id).set(
        document.model_dump(mode="json")
    )
    logger.info(
        "document_uploaded id=%s patient=%s bytes=%d mime=%s by=%s",
        doc_id, patient_id, bytes_written, content_type, user.uid,
    )
    return DocumentResponse(id=doc_id, document=document)


@router.get("", response_model=DocumentListResponse, summary="List patient documents, newest first")
def list_documents(patient_id: str, user: TenantUserDep) -> DocumentListResponse:
    db = get_db()
    patient_ref = _require_patient(db, user, patient_id)
    snaps = (
        patient_ref.collection("documents")
        .order_by("created_at", direction="DESCENDING")
        .stream()
    )
    out: list[DocumentResponse] = []
    for snap in snaps:
        try:
            doc = PatientDocument.model_validate(snap.to_dict())
        except Exception:
            logger.warning("skipping_invalid_document id=%s", snap.id)
            continue
        out.append(DocumentResponse(id=snap.id, document=doc))
    return DocumentListResponse(documents=out)


def _load_document(user, patient_id: str, doc_id: str):
    """Direct doc lookup at the canonical path — tenancy comes from claims."""
    db = get_db()
    _require_patient(db, user, patient_id)
    ref = (
        _patient_ref(db, user.org_id, user.active_clinic_id, patient_id)
        .collection("documents")
        .document(doc_id)
    )
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="document_not_found"
        )
    doc = PatientDocument.model_validate(snap.to_dict())
    return doc, ref


@router.get(
    "/{doc_id}/download-url",
    response_model=DownloadUrlResponse,
    summary="Short-lived signed URL for viewing/printing the document",
)
def get_download_url(patient_id: str, doc_id: str, user: TenantUserDep) -> DownloadUrlResponse:
    from app.services.storage import signed_audio_url

    doc, _ = _load_document(user, patient_id, doc_id)
    url = signed_audio_url(doc.storage_path, expires_minutes=60)
    if not url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="document_url_unavailable"
        )
    return DownloadUrlResponse(
        url=url,
        expires_in_seconds=3600,
        filename=doc.filename,
        content_type=doc.content_type,
    )


@router.delete(
    "/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a patient document (storage blob + metadata)",
)
def delete_document(patient_id: str, doc_id: str, user: ClinicianDep) -> None:
    doc, ref = _load_document(user, patient_id, doc_id)

    # Best-effort blob delete — the Firestore doc is the source of truth, so
    # an orphaned blob is preferable to a dangling metadata entry.
    try:
        from firebase_admin import storage

        gs_uri = doc.storage_path
        if gs_uri.startswith("gs://"):
            _, _, rest = gs_uri.partition("gs://")
            bucket_name, _, path = rest.partition("/")
            storage.bucket(bucket_name).blob(path).delete()
    except Exception:
        logger.warning("document_blob_delete_failed id=%s patient=%s", doc_id, patient_id)

    ref.delete()
    logger.info("document_deleted id=%s patient=%s by=%s", doc_id, patient_id, user.uid)
