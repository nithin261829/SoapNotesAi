"""Recording read + edit + PDF endpoints.

All recordings are scoped to the caller's active org + clinic via custom claims.
PDFs are rendered on demand — never stored.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel

from app.auth.deps import ClinicianDep, TenantUserDep
from app.models.common import utc_now
from app.models.recording import Recording
from app.models.soap import SoapNote
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"])

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


# ─── Shapes ────────────────────────────────────────────────────────


class RecordingResponse(BaseModel):
    id: str
    recording: Recording


class RecordingListResponse(BaseModel):
    recordings: list[RecordingResponse]


class PatchSoapRequest(BaseModel):
    soap: SoapNote


# ─── Helpers ───────────────────────────────────────────────────────


def _clinic_ref(db, org_id: str, clinic_id: str):
    return db.collection("organizations").document(org_id).collection("clinics").document(clinic_id)


def _patient_ref(db, org_id: str, clinic_id: str, patient_id: str):
    return _clinic_ref(db, org_id, clinic_id).collection("patients").document(patient_id)


# ─── Endpoints ─────────────────────────────────────────────────────


@router.get("", response_model=RecordingListResponse)
def list_recordings(patient_id: str, user: TenantUserDep) -> RecordingListResponse:
    db = get_db()
    snaps = (
        _patient_ref(db, user.org_id, user.active_clinic_id, patient_id)
        .collection("recordings")
        .order_by("created_at", direction="DESCENDING")
        .stream()
    )
    out: list[RecordingResponse] = []
    for snap in snaps:
        try:
            rec = Recording.model_validate(snap.to_dict())
        except Exception:
            logger.warning("skipping_invalid_recording id=%s", snap.id)
            continue
        out.append(RecordingResponse(id=snap.id, recording=rec))
    return RecordingListResponse(recordings=out)


def _load_recording(user, patient_id: str, recording_id: str):
    """Direct doc lookup — no collectionGroup query, no composite index needed."""
    db = get_db()
    ref = (
        _patient_ref(db, user.org_id, user.active_clinic_id, patient_id)
        .collection("recordings")
        .document(recording_id)
    )
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="recording_not_found")
    rec = Recording.model_validate(snap.to_dict())
    return rec, ref


@router.get("/{recording_id}", response_model=RecordingResponse)
def get_recording(recording_id: str, patient_id: str, user: TenantUserDep) -> RecordingResponse:
    rec, _ = _load_recording(user, patient_id, recording_id)
    return RecordingResponse(id=recording_id, recording=rec)


@router.patch("/{recording_id}", response_model=RecordingResponse)
def patch_recording_soap(
    recording_id: str,
    patient_id: str,
    body: PatchSoapRequest,
    user: ClinicianDep,
) -> RecordingResponse:
    """Overwrite the embedded SoapNote. Stamps edited_by_doctor=True."""
    rec, ref = _load_recording(user, patient_id, recording_id)

    now = utc_now()
    # Server-controlled fields are never taken from the client: AI provenance
    # stays scrubbed (usage collection is the record of truth) and signature/
    # validation metadata carries over from the stored note.
    stored = rec.soap
    soap = body.soap.model_copy(
        update={
            "edited_by_doctor": True,
            "updated_at": now,
            "llm_provider": None,
            "llm_model_version": None,
            "validated": stored.validated if stored else False,
            "signed_at": stored.signed_at if stored else None,
            "signed_by_uid": stored.signed_by_uid if stored else None,
        }
    )

    ref.update({"soap": soap.model_dump(mode="json"), "updated_at": now})
    rec = rec.model_copy(update={"soap": soap, "updated_at": now})
    logger.info("recording_soap_edited id=%s by=%s", recording_id, user.uid)
    return RecordingResponse(id=recording_id, recording=rec)


@router.get(
    "/{recording_id}/audio-url",
    summary="Short-lived signed URL for playback of the stored audio",
)
def get_audio_url(
    recording_id: str, patient_id: str, user: TenantUserDep
) -> dict[str, object]:
    from app.services.storage import signed_audio_url

    rec, _ = _load_recording(user, patient_id, recording_id)
    url = signed_audio_url(rec.audio_storage_path, expires_minutes=60)
    if not url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="audio_url_unavailable"
        )
    return {"url": url, "expires_in_seconds": 3600, "mime_type": rec.mime_type}


@router.get(
    "/{recording_id}/pdf",
    summary="Render the stored SOAP as a PDF (always fresh, never cached)",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/pdf": {}}}},
)
def render_pdf(recording_id: str, patient_id: str, user: TenantUserDep) -> StreamingResponse:
    db = get_db()
    rec, _ = _load_recording(user, patient_id, recording_id)
    if rec.soap is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="soap_not_ready")

    # Clinic letterhead for the header — logo is embedded as base64 so it
    # always renders into the PDF (no external links).
    from app.services.letterhead_render import letterhead_context

    clinic_snap = _clinic_ref(db, user.org_id, user.active_clinic_id).get()
    clinic_data = clinic_snap.to_dict() if clinic_snap.exists else {}
    letterhead_ctx = letterhead_context(user.org_id, user.active_clinic_id, clinic_data)

    # Follow-up sheet engine: the patient's FIRST encounter prints on the
    # branded primary letterhead; every later encounter prints on a plain
    # continuation sheet with a subtle security watermark (saves letterhead
    # stock and marks the page as part of an existing case file).
    recs_col = (
        _patient_ref(db, user.org_id, user.active_clinic_id, patient_id)
        .collection("recordings")
    )
    first_snap = next(iter(recs_col.order_by("created_at").limit(1).stream()), None)
    is_continuation = bool(first_snap and first_snap.id != recording_id)
    continuation_of: Optional[str] = None
    if is_continuation:
        prev_snap = next(
            iter(
                recs_col.where("created_at", "<", rec.created_at.isoformat())
                .order_by("created_at", direction="DESCENDING")
                .limit(1)
                .stream()
            ),
            None,
        )
        if prev_snap:
            prev = prev_snap.to_dict() or {}
            continuation_of = ((prev.get("soap") or {}).get("patient") or {}).get(
                "encounter_date"
            ) or (prev.get("created_at") or "")[:10]

    # Doctor profile for the signature block.
    user_snap = db.collection("users").document(user.uid).get()
    user_data = user_snap.to_dict() if user_snap.exists else {}
    doctor_name = (user_data or {}).get("display_name") or user.email or "—"
    doctor_credentials = (user_data or {}).get("credentials")

    try:
        template = _jinja.get_template("soap_note.html")
        html = template.render(
            patient=rec.soap.patient,
            subjective=rec.soap.subjective,
            objective=rec.soap.objective,
            assessment=rec.soap.assessment,
            plan=rec.soap.plan,
            transcript=(rec.transcript.text if rec.transcript else ""),
            clinic={"letterhead": letterhead_ctx},
            sheet="continuation" if is_continuation else "primary",
            continuation_of=continuation_of,
            watermark_text=(
                f"{letterhead_ctx.get('name') or 'Clinic'} · case continuation"
                if is_continuation
                else None
            ),
            doctor={
                "display_name": doctor_name,
                "credentials": doctor_credentials,
                "verified": (user_data or {}).get("verification_status") == "verified",
                "registration_id": (user_data or {}).get("registration_id"),
            },
            generated_at=utc_now().strftime("%Y-%m-%d %H:%M UTC"),
        )
    except Exception as e:
        logger.exception("recording_pdf_template_failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="template_render_failed",
        ) from e

    try:
        from weasyprint import HTML  # noqa: PLC0415

        pdf_bytes = HTML(string=html).write_pdf()
    except OSError as e:
        logger.exception("recording_pdf_native_deps_missing")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pdf_native_deps_missing",
        ) from e
    except Exception as e:
        logger.exception("recording_pdf_render_failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="pdf_render_failed",
        ) from e

    safe_name = (rec.soap.patient.name or "patient").strip().replace(" ", "_")[:40] or "patient"
    filename = f"soap_{safe_name}_{rec.soap.patient.encounter_date}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
