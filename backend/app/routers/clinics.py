"""Clinic letterhead management.

The letterhead (clinic name, address, phone, tagline, logo) prints at the top
of every PDF. The logo image is EMBEDDED into the PDF as base64 at render time
— it always displays, regardless of network.

Paid changes (product rule): the first letterhead setup is free (covered by
the joining fee); every later change debits a service fee from the org wallet
(default ₹49, override via app_config/billing.letterhead_change_fee_paise).
Fee collection honors the same app_config/billing.enforce kill-switch as
note charging — while off, changes are free and logged.
"""
from __future__ import annotations

import logging
import os
import tempfile
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth.deps import OwnerDep, TenantUserDep
from app.models.billing import WalletDoc, WalletTransaction
from app.models.clinic import Clinic, ClinicLetterhead
from app.models.common import utc_now
from app.services.app_config import get_config_doc
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clinics", tags=["clinics"])

from app.services.billing_service import enforcement_on
from app.services.pricing import DEFAULT_LETTERHEAD_CHANGE_FEE_PAISE as DEFAULT_CHANGE_FEE_PAISE

MAX_LOGO_BYTES = 5 * 1024 * 1024
ALLOWED_LOGO_TYPES = {"image/png": "png", "image/jpeg": "jpg"}


def _clinic_ref(db, org_id: str, clinic_id: str):
    return db.collection("organizations").document(org_id).collection("clinics").document(clinic_id)


def _change_fee_paise() -> int:
    v = get_config_doc("billing").get("letterhead_change_fee_paise")
    try:
        return int(v) if v is not None else DEFAULT_CHANGE_FEE_PAISE
    except (TypeError, ValueError):
        return DEFAULT_CHANGE_FEE_PAISE


_enforcement_on = enforcement_on  # shared kill-switch from billing_service


class LetterheadResponse(BaseModel):
    letterhead: ClinicLetterhead
    has_logo: bool
    change_count: int
    next_change_fee_paise: int  # 0 = free (first setup)


@router.get("/letterhead", response_model=LetterheadResponse)
def get_letterhead(user: TenantUserDep) -> LetterheadResponse:
    db = get_db()
    snap = _clinic_ref(db, user.org_id, user.active_clinic_id).get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="clinic_not_found")
    clinic = Clinic.model_validate(snap.to_dict())
    return LetterheadResponse(
        letterhead=clinic.letterhead,
        has_logo=bool(clinic.letterhead.logo_storage_path),
        change_count=clinic.letterhead_change_count,
        next_change_fee_paise=0 if clinic.letterhead_change_count == 0 else _change_fee_paise(),
    )


@router.post("/letterhead", response_model=LetterheadResponse)
async def update_letterhead(
    user: OwnerDep,
    name: Annotated[Optional[str], Form(max_length=120)] = None,
    address: Annotated[Optional[str], Form(max_length=400)] = None,  # newline-separated
    phone: Annotated[Optional[str], Form(max_length=20)] = None,
    email: Annotated[Optional[str], Form(max_length=120)] = None,
    tagline: Annotated[Optional[str], Form(max_length=160)] = None,
    logo: Annotated[Optional[UploadFile], File()] = None,
) -> LetterheadResponse:
    db = get_db()
    ref = _clinic_ref(db, user.org_id, user.active_clinic_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="clinic_not_found")
    clinic = Clinic.model_validate(snap.to_dict())

    # Fee amount decided up front, but ONLY debited after every fallible step
    # (validation, storage upload) has succeeded — a failed change must never
    # cost money, and a retry must never double-charge.
    fee = _change_fee_paise() if clinic.letterhead_change_count > 0 else 0

    # ── Optional logo upload (embedded into PDFs at render time) ──
    logo_gs_uri = clinic.letterhead.logo_storage_path
    if logo is not None:
        content_type = (logo.content_type or "").lower()
        if content_type not in ALLOWED_LOGO_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="logo_must_be_png_or_jpeg",
            )
        fd, tmp_path = tempfile.mkstemp(prefix="letterhead-")
        bytes_written = 0
        try:
            with os.fdopen(fd, "wb") as out:
                while True:
                    chunk = await logo.read(64 * 1024)
                    if not chunk:
                        break
                    bytes_written += len(chunk)
                    if bytes_written > MAX_LOGO_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            detail="logo_too_large",
                        )
                    out.write(chunk)
            if bytes_written == 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty_logo")
            with open(tmp_path, "rb") as f:
                logo_bytes = f.read()
            from firebase_admin import storage as fb_storage

            bucket = fb_storage.bucket()
            ext = ALLOWED_LOGO_TYPES[content_type]
            path = (
                f"organizations/{user.org_id}/clinics/{user.active_clinic_id}/"
                f"letterhead/logo.{ext}"
            )
            bucket.blob(path).upload_from_string(logo_bytes, content_type=content_type)
            logo_gs_uri = f"gs://{bucket.name}/{path}"
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("letterhead_logo_upload_failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail="storage_upload_failed"
            ) from e
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    # ── Everything fallible succeeded — now charge, then persist ──
    if fee > 0:
        _charge_letterhead_fee(db, user.org_id, user.uid, user.active_clinic_id, fee)

    # ── Persist merged letterhead ──
    new_letterhead = ClinicLetterhead(
        name=(name or clinic.letterhead.name).strip() or clinic.letterhead.name,
        address_lines=(
            [ln.strip() for ln in address.splitlines() if ln.strip()]
            if address is not None
            else clinic.letterhead.address_lines
        ),
        phone=phone.strip() if phone is not None else clinic.letterhead.phone,
        email=email.strip() if email is not None else clinic.letterhead.email,
        tagline=tagline.strip() if tagline is not None else clinic.letterhead.tagline,
        logo_storage_path=logo_gs_uri,
    )
    now = utc_now()
    new_count = clinic.letterhead_change_count + 1
    ref.update(
        {
            "letterhead": new_letterhead.model_dump(mode="json"),
            "letterhead_change_count": new_count,
            "updated_at": now,
        }
    )
    # Invalidate the render-time logo cache so the next PDF picks it up.
    from app.services.letterhead_render import invalidate_logo_cache

    invalidate_logo_cache(user.org_id, user.active_clinic_id)

    logger.info(
        "letterhead_updated org=%s clinic=%s change#%d fee=%d",
        user.org_id, user.active_clinic_id, new_count, fee,
    )
    return LetterheadResponse(
        letterhead=new_letterhead,
        has_logo=bool(logo_gs_uri),
        change_count=new_count,
        next_change_fee_paise=_change_fee_paise(),
    )


def _charge_letterhead_fee(db, org_id: str, uid: str, clinic_id: str, fee_paise: int) -> None:
    """Debit the change fee from the org wallet; 402 when enforcement is on
    and the balance is insufficient. Log-only while enforcement is off."""
    if not _enforcement_on():
        logger.info("letterhead_fee_skipped org=%s fee=%d (enforce off)", org_id, fee_paise)
        return
    from google.cloud import firestore as gcf

    wallet_ref = (
        db.collection("organizations").document(org_id).collection("billing").document("wallet")
    )
    transaction = db.transaction()

    @gcf.transactional
    def _txn(txn):
        snap = wallet_ref.get(transaction=txn)
        wallet = WalletDoc.model_validate(snap.to_dict()) if snap.exists else WalletDoc()
        if wallet.balance_paise < fee_paise:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="insufficient_wallet_balance",
            )
        now = utc_now()
        new_balance = wallet.balance_paise - fee_paise
        txn.set(
            wallet_ref,
            WalletDoc(balance_paise=new_balance, updated_at=now).model_dump(mode="json"),
        )
        tx = WalletTransaction(
            type="debit",
            amount_paise=fee_paise,
            balance_after_paise=new_balance,
            reason="letterhead_change",
            created_by_uid=uid,
            created_at=now,
        )
        txn.set(wallet_ref.collection("transactions").document(), tx.model_dump(mode="json"))

    _txn(transaction)
    logger.info("letterhead_fee_charged org=%s clinic=%s fee=%d", org_id, clinic_id, fee_paise)
