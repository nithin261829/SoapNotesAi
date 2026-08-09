"""Doctor verification: proof-of-registration submission + status.

A doctor submits their medical-council registration details plus a proof
document (PDF / JPEG / PNG). The proof is uploaded to the default Storage
bucket under `verification/{uid}/proof.<ext>` — that prefix has NO match in
storage.rules, so clients can never read each other's (or their own) proof
files; only the backend Admin SDK and console admins can.

Firestore side effect on users/{uid}:
    verification_status: "pending"
    verification: {medical_council, registration_number,
                   proof_storage_path (gs:// URI), submitted_at}

Approval flow is MANUAL for now: an admin reviews the proof in the Firebase
console and sets `verification_status` to "verified" (also stamping
`verified_at`) or "rejected" (also setting `verification.rejection_reason`)
directly on the users/{uid} doc. No admin API endpoint exists yet.

Status lifecycle: unverified → pending → verified | rejected.
Re-submission is allowed while "pending" or after "rejected" (it overwrites
the previous submission); a "verified" doctor gets 409 already_verified.
"""
from __future__ import annotations

import logging
import os
import tempfile
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth.deps import CurrentUserDep
from app.models.common import utc_now
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/verification", tags=["verification"])

ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
}

MAX_PROOF_BYTES = 10 * 1024 * 1024  # 10 MB
CHUNK_SIZE = 64 * 1024

VerificationStatus = Literal["unverified", "pending", "verified", "rejected"]


# ─── Shapes ────────────────────────────────────────────────────────


class SubmitVerificationResponse(BaseModel):
    status: Literal["pending"] = "pending"
    medical_council: str
    registration_number: str
    submitted_at: str


class VerificationStatusResponse(BaseModel):
    status: VerificationStatus
    medical_council: Optional[str] = None
    registration_number: Optional[str] = None
    submitted_at: Optional[str] = None
    rejection_reason: Optional[str] = None
    # proof_storage_path is intentionally never returned.


# ─── Endpoints ─────────────────────────────────────────────────────


@router.post(
    "/submit",
    status_code=status.HTTP_201_CREATED,
    response_model=SubmitVerificationResponse,
    summary="Submit medical-council registration proof for manual review",
)
async def submit_verification(
    user: CurrentUserDep,
    medical_council: Annotated[str, Form(description="Issuing medical council name.")],
    registration_number: Annotated[str, Form(description="Council registration number.")],
    proof: Annotated[
        UploadFile, File(description="Proof document (PDF, JPEG, or PNG; max 10 MB).")
    ],
) -> SubmitVerificationResponse:
    medical_council = medical_council.strip()
    registration_number = registration_number.strip()
    if not medical_council or not registration_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="missing_registration_details",
        )

    content_type = (proof.content_type or "").lower()
    extension = ALLOWED_MIME_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_proof_format",
        )

    # A verified doctor can't overwrite their approved record; pending and
    # rejected submissions may be replaced.
    db = get_db()
    user_ref = db.collection("users").document(user.uid)
    user_snap = user_ref.get()
    user_data = user_snap.to_dict() if user_snap.exists else {}
    if (user_data or {}).get("verification_status") == "verified":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="already_verified"
        )

    # Stream the proof to a temp file so an oversized upload never sits in
    # memory (same pattern as app/routers/audio.py).
    fd, tmp_path = tempfile.mkstemp(suffix=f".{extension}", prefix="soapnotesai-proof-")
    try:
        bytes_written = 0
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await proof.read(CHUNK_SIZE)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_PROOF_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail="proof_too_large",
                    )
                out.write(chunk)

        if bytes_written == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="empty_proof"
            )

        # Upload to the backend-only verification/ prefix in the default bucket.
        try:
            from firebase_admin import storage

            bucket = storage.bucket()
            path = f"verification/{user.uid}/proof.{extension}"
            # Best-effort cleanup of a previous proof with a different extension
            # so a re-submission doesn't leave a stale file behind.
            try:
                for old_blob in bucket.list_blobs(prefix=f"verification/{user.uid}/proof."):
                    if old_blob.name != path:
                        old_blob.delete()
            except Exception:
                logger.warning("verification_old_proof_cleanup_failed uid=%s", user.uid)
            blob = bucket.blob(path)
            blob.upload_from_filename(tmp_path, content_type=content_type)
            gs_uri = f"gs://{bucket.name}/{path}"
        except Exception as e:
            logger.exception("verification_proof_upload_failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail="storage_upload_failed"
            ) from e
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError as e:
                logger.warning("failed to cleanup temp file %s: %s", tmp_path, e)

    submitted_at = utc_now().isoformat()
    verification = {
        "medical_council": medical_council,
        "registration_number": registration_number,
        "proof_storage_path": gs_uri,
        "submitted_at": submitted_at,
    }
    payload = {
        "verification_status": "pending",
        # Whole-map write (not a deep merge) so a stale rejection_reason from a
        # previous rejection doesn't survive the re-submission.
        "verification": verification,
        "updated_at": utc_now(),
    }
    if user_snap.exists:
        user_ref.update(payload)
    else:
        # Not provisioned yet (no users/{uid} doc) — still record the
        # submission so it's merged into the profile when provisioning runs.
        user_ref.set(payload, merge=True)

    logger.info(
        "verification_submitted uid=%s bytes=%d mime=%s", user.uid, bytes_written, content_type
    )
    return SubmitVerificationResponse(
        medical_council=medical_council,
        registration_number=registration_number,
        submitted_at=submitted_at,
    )


@router.get(
    "/status",
    response_model=VerificationStatusResponse,
    summary="Current verification status for the caller",
)
def get_verification_status(user: CurrentUserDep) -> VerificationStatusResponse:
    db = get_db()
    snap = db.collection("users").document(user.uid).get()
    data = (snap.to_dict() if snap.exists else {}) or {}

    raw_status = data.get("verification_status")
    v_status: VerificationStatus = (
        raw_status if raw_status in ("pending", "verified", "rejected") else "unverified"
    )
    verification = data.get("verification")
    if not isinstance(verification, dict):
        verification = {}

    return VerificationStatusResponse(
        status=v_status,
        medical_council=verification.get("medical_council"),
        registration_number=verification.get("registration_number"),
        submitted_at=verification.get("submitted_at"),
        rejection_reason=verification.get("rejection_reason"),
    )
