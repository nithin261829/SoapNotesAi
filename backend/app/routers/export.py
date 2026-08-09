"""Quarterly Excel export — owner-only (contains financial data).

Streams an .xlsx with three sheets, all scoped to the caller's org and
covering the last N months by created_at:

    Patients          — one row per patient across ALL clinics in the org
    Visits            — one row per recording in the window
    Financial Summary — wallet transactions + totals

Docs are written to Firestore via model_dump(mode="json"), so timestamps are
stored as ISO-8601 strings; parsing here accepts both strings and native
datetimes and skips anything that fails to parse.
"""
from __future__ import annotations

import calendar
import io
import logging
from datetime import date, datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from app.auth.deps import OwnerDep
from app.models.common import utc_now
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["export"])

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


# ─── Helpers ───────────────────────────────────────────────────────


def _parse_dt(value: Any) -> Optional[datetime]:
    """Best-effort parse of a Firestore timestamp field into an aware UTC datetime."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _iso(value: Any) -> str:
    """Render a timestamp-ish value as an ISO string, or '' when absent."""
    dt = _parse_dt(value)
    if dt is not None:
        return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return ""


def _months_ago(now: datetime, months: int) -> datetime:
    """Calendar-aware `now - months` (clamps the day, e.g. May 31 → Feb 28)."""
    year, month = now.year, now.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(now.day, calendar.monthrange(year, month)[1])
    return now.replace(year=year, month=month, day=day)


def _in_window(value: Any, cutoff: datetime) -> bool:
    """True when the timestamp parses and falls inside the window.

    Docs with a missing/unparseable created_at are kept (we can't prove they
    are out of window, and dropping data from a financial export is worse).
    """
    dt = _parse_dt(value)
    return dt is None or dt >= cutoff


def _age(data: dict[str, Any]) -> Any:
    age = data.get("age_at_record")
    if age is not None:
        return age
    dob = data.get("date_of_birth")
    parsed: Optional[date] = None
    if isinstance(dob, datetime):
        parsed = dob.date()
    elif isinstance(dob, date):
        parsed = dob
    elif isinstance(dob, str) and dob:
        try:
            parsed = date.fromisoformat(dob[:10])
        except ValueError:
            parsed = None
    if parsed is None:
        return ""
    today = utc_now().date()
    return today.year - parsed.year - (
        (today.month, today.day) < (parsed.month, parsed.day)
    )


def _sheet(wb: Workbook, title: str, headers: list[str], widths: list[int]):
    ws = wb.create_sheet(title=title)
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.freeze_panes = "A2"
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    return ws


# ─── Endpoint ──────────────────────────────────────────────────────


@router.get(
    "/excel",
    summary="Owner-only Excel export of patients, visits, and finances",
    response_class=StreamingResponse,
    responses={200: {"content": {_XLSX_MEDIA_TYPE: {}}}},
)
def export_excel(
    user: OwnerDep,
    months: Annotated[int, Query(ge=1, le=12, description="Window in months")] = 3,
) -> StreamingResponse:
    db = get_db()
    now = utc_now()
    cutoff = _months_ago(now, months)
    org_ref = db.collection("organizations").document(user.org_id)

    wb = Workbook()
    wb.remove(wb.active)  # drop the default empty sheet

    ws_patients = _sheet(
        wb,
        "Patients",
        ["Clinic", "Patient ID", "Name", "Phone", "Sex", "Age",
         "Created", "Last Visit", "Total Encounters"],
        [22, 24, 26, 16, 10, 8, 22, 22, 16],
    )
    ws_visits = _sheet(
        wb,
        "Visits",
        ["Clinic", "Patient Name", "Date", "Encounter Date", "Duration (sec)",
         "Status", "Chief Complaint", "Diagnoses"],
        [22, 26, 22, 14, 14, 12, 40, 40],
    )
    ws_fin = _sheet(
        wb,
        "Financial Summary",
        ["Date", "Type", "Reason", "Amount (INR)", "Balance After (INR)"],
        [22, 10, 28, 14, 18],
    )

    # ── Patients + Visits: iterate every clinic in the org ─────────
    for clinic_snap in org_ref.collection("clinics").stream():
        clinic_data = clinic_snap.to_dict() or {}
        clinic_name = clinic_data.get("name") or clinic_snap.id

        for patient_snap in clinic_snap.reference.collection("patients").stream():
            try:
                p = patient_snap.to_dict() or {}
                patient_name = p.get("name") or ""

                if _in_window(p.get("created_at"), cutoff):
                    ws_patients.append([
                        clinic_name,
                        patient_snap.id,
                        patient_name,
                        p.get("phone") or "",
                        p.get("sex") or "",
                        _age(p),
                        _iso(p.get("created_at")),
                        _iso(p.get("last_encounter_at")),
                        p.get("recording_count") or 0,
                    ])
            except Exception:
                logger.warning("export_skipping_patient id=%s", patient_snap.id)
                continue

            # Visits are windowed independently of the patient row — an old
            # patient can still have recent recordings.
            try:
                rec_snaps = list(
                    patient_snap.reference.collection("recordings").stream()
                )
            except Exception:
                logger.warning(
                    "export_skipping_recordings patient=%s", patient_snap.id
                )
                continue

            for rec_snap in rec_snaps:
                try:
                    r = rec_snap.to_dict() or {}
                    if not _in_window(r.get("created_at"), cutoff):
                        continue
                    soap = r.get("soap") or {}
                    subjective = soap.get("subjective") or {}
                    assessment = soap.get("assessment") or {}
                    soap_patient = soap.get("patient") or {}
                    diagnoses = assessment.get("diagnoses") or []
                    if not isinstance(diagnoses, list):
                        diagnoses = [diagnoses]
                    ws_visits.append([
                        clinic_name,
                        patient_name,
                        _iso(r.get("created_at")),
                        _iso(soap_patient.get("encounter_date")),
                        r.get("duration_seconds") if r.get("duration_seconds") is not None else "",
                        r.get("status") or "",
                        subjective.get("chief_complaint") or "",
                        "; ".join(str(d) for d in diagnoses if d),
                    ])
                except Exception:
                    logger.warning("export_skipping_recording id=%s", rec_snap.id)
                    continue

    # ── Financial Summary: org-level wallet transactions ───────────
    total_credits_paise = 0
    total_debits_paise = 0
    tx_rows: list[tuple[Optional[datetime], list[Any]]] = []

    tx_col = (
        org_ref.collection("billing").document("wallet").collection("transactions")
    )
    for tx_snap in tx_col.stream():
        try:
            tx = tx_snap.to_dict() or {}
            if not _in_window(tx.get("created_at"), cutoff):
                continue
            tx_type = tx.get("type") or ""
            amount_paise = tx.get("amount_paise")
            balance_after_paise = tx.get("balance_after_paise")
            if isinstance(amount_paise, (int, float)):
                if tx_type == "credit":
                    total_credits_paise += int(amount_paise)
                elif tx_type == "debit":
                    total_debits_paise += int(amount_paise)
            tx_rows.append((
                _parse_dt(tx.get("created_at")),
                [
                    _iso(tx.get("created_at")),
                    tx_type,
                    tx.get("reason") or "",
                    round(amount_paise / 100, 2)
                    if isinstance(amount_paise, (int, float)) else "",
                    round(balance_after_paise / 100, 2)
                    if isinstance(balance_after_paise, (int, float)) else "",
                ],
            ))
        except Exception:
            logger.warning("export_skipping_transaction id=%s", tx_snap.id)
            continue

    # Oldest first; undated rows sink to the bottom.
    tx_rows.sort(key=lambda item: (item[0] is None, item[0] or datetime.min.replace(tzinfo=timezone.utc)))
    for _, row in tx_rows:
        ws_fin.append(row)

    ws_fin.append([])
    bold = Font(bold=True)
    for label, paise in (
        ("Total credits", total_credits_paise),
        ("Total debits", total_debits_paise),
        ("Net", total_credits_paise - total_debits_paise),
    ):
        ws_fin.append([label, "", "", round(paise / 100, 2), ""])
        for cell in ws_fin[ws_fin.max_row]:
            cell.font = bold

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"soapnotes_export_{now.date().isoformat()}.xlsx"
    logger.info(
        "excel_export org=%s months=%s by=%s", user.org_id, months, user.uid
    )
    return StreamingResponse(
        buf,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
