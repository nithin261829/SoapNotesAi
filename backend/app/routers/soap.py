"""SOAP-note PDF rendering.

Stateless endpoint: receives an edited SoapNote + transcript, renders the
Jinja template under `app/templates/soap_note.html`, and streams a PDF back.
No persistence yet — the canonical copy still lives on the device until step 9
wires Firestore + GCS in.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel

from app.models.common import utc_now
from app.models.soap import SoapNote

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/soap", tags=["soap"])

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


class GeneratePdfRequest(BaseModel):
    soap: SoapNote
    transcript: str | None = None
    clinic_name: str | None = "SoapNotesAi"
    doctor_name: str | None = None
    doctor_credentials: str | None = None


@router.post(
    "/pdf",
    summary="Render the (edited) SOAP note as a PDF",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/pdf": {}}}},
)
def generate_soap_pdf(body: GeneratePdfRequest) -> StreamingResponse:
    try:
        template = _jinja.get_template("soap_note.html")
        html = template.render(
            patient=body.soap.patient,
            subjective=body.soap.subjective,
            objective=body.soap.objective,
            assessment=body.soap.assessment,
            plan=body.soap.plan,
            transcript=body.transcript or "",
            clinic={"letterhead": {"name": body.clinic_name or "Clinic"}},
            doctor={
                "display_name": body.doctor_name or "—",
                "credentials": body.doctor_credentials,
            },
            generated_at=_human_time(utc_now()),
        )
    except Exception as e:  # template/render error
        logger.exception("soap_pdf_template_render_failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="template_render_failed",
        ) from e

    # Import weasyprint lazily so the rest of the backend boots even when the
    # native deps (pango, cairo, glib) aren't installed. On macOS install via:
    #   brew install pango
    try:
        from weasyprint import HTML  # noqa: PLC0415
    except OSError as e:
        logger.exception("soap_pdf_weasyprint_missing_native_deps")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pdf_native_deps_missing",
        ) from e

    try:
        pdf_bytes = HTML(string=html).write_pdf()
    except Exception as e:  # weasyprint error (missing fonts, broken HTML, etc.)
        logger.exception("soap_pdf_weasyprint_failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="pdf_render_failed",
        ) from e

    filename = _suggested_filename(body.soap)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _suggested_filename(soap: SoapNote) -> str:
    safe_name = (soap.patient.name or "patient").strip().replace(" ", "_")[:40] or "patient"
    return f"soap_{safe_name}_{soap.patient.encounter_date}.pdf"


def _human_time(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC")
