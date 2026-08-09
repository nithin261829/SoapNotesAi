"""Note-generation billing gate + per-note wallet charging.

Tier rules (from the product requirements):
  - premium, active            → unlimited notes
  - trial (joining fee, 7d)    → unlimited during trial
  - standard, active           → up to 30 cases per day
  - payg / everything else     → ₹5 per note debited from the prepaid wallet

Kill-switch: Firestore doc `app_config/billing` field `enforce` (bool).
While false (the default), the gate only LOGS what it would have done — so
existing users aren't locked out before wallets/plans exist. Flip `enforce`
to true in Firestore to turn real enforcement on (no redeploy needed).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, status

from app.models.billing import SubscriptionDoc, WalletDoc, WalletTransaction
from app.models.common import utc_now
from app.services.app_config import get_config_doc
from app.services.firestore import get_db
from app.services.pricing import IST, PER_NOTE_PAISE, STANDARD_DAILY_CASE_LIMIT

logger = logging.getLogger(__name__)

# Kept as an alias so charge/gate can never drift from the advertised price.
NOTE_CHARGE_PAISE = PER_NOTE_PAISE

ChargeMode = Literal["free", "payg"]


@dataclass(frozen=True)
class NoteAllowance:
    mode: ChargeMode
    reason: str  # "premium" | "trial" | "standard" | "payg"
    # Set when a standard-tier daily slot was transactionally reserved; the
    # caller must release_note_slot() if the note ultimately fails.
    reserved_slot_key: str | None = None


def enforcement_on() -> bool:
    """Shared billing kill-switch (app_config/billing.enforce)."""
    return bool(get_config_doc("billing").get("enforce", False))


# Backwards-compatible private alias (older call sites/tests).
_enforcement_on = enforcement_on


def _ist_day_key() -> str:
    """Quota days run midnight-to-midnight IST — the clinics' local day."""
    return utc_now().astimezone(IST).date().isoformat()


def _billing_doc(db, org_id: str, name: str):
    return (
        db.collection("organizations")
        .document(org_id)
        .collection("billing")
        .document(name)
    )


def check_note_allowance(org_id: str, clinic_id: str) -> NoteAllowance:
    """Decide how this note is paid for; raise 402/429 if not allowed.

    Billing is PER CLINIC: the paid tier lives on the clinic's subscription
    doc; the org-level doc carries the joining-fee trial (covers all clinics).
    Called BEFORE the AI call so we don't spend Vertex money on a request
    we'd refuse to persist.
    """
    db = get_db()
    now = utc_now()
    enforce = _enforcement_on()

    sub_snap = _billing_doc(db, org_id, f"subscription_{clinic_id}").get()
    sub = (
        SubscriptionDoc.model_validate(sub_snap.to_dict())
        if sub_snap.exists
        else SubscriptionDoc()
    )
    org_snap = _billing_doc(db, org_id, "subscription").get()
    org_sub = (
        SubscriptionDoc.model_validate(org_snap.to_dict())
        if org_snap.exists
        else SubscriptionDoc()
    )

    if sub.tier == "premium" and sub.status == "active" and (
        sub.current_period_end is None or sub.current_period_end > now
    ):
        return NoteAllowance(mode="free", reason="premium")

    if org_sub.status == "trial" and org_sub.trial_ends_at and org_sub.trial_ends_at > now:
        return NoteAllowance(mode="free", reason="trial")

    if sub.tier == "standard" and sub.status == "active" and (
        sub.current_period_end is None or sub.current_period_end > now
    ):
        # Race-proof daily cap: a transactional counter doc per clinic per IST
        # day RESERVES the slot atomically before the (multi-second) AI call,
        # so concurrent uploads can't all pass at count=29. The caller
        # releases the slot if the note ultimately fails.
        day_key = _ist_day_key()
        counter_key = f"{clinic_id}_{day_key}"
        counter_ref = (
            db.collection("organizations")
            .document(org_id)
            .collection("usage_counters")
            .document(counter_key)
        )
        from google.cloud import firestore as gcf

        transaction = db.transaction()

        @gcf.transactional
        def _reserve(txn) -> int:
            snap = counter_ref.get(transaction=txn)
            count = int((snap.to_dict() or {}).get("count") or 0) if snap.exists else 0
            if enforce and count >= STANDARD_DAILY_CASE_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="daily_case_limit_reached",
                )
            txn.set(
                counter_ref,
                {"count": count + 1, "clinic_id": clinic_id, "day": day_key},
            )
            return count + 1

        new_count = _reserve(transaction)
        if not enforce and new_count > STANDARD_DAILY_CASE_LIMIT:
            logger.info(
                "billing_gate_wouldblock org=%s reason=daily_limit count=%d (enforce off)",
                org_id, new_count,
            )
        return NoteAllowance(mode="free", reason="standard", reserved_slot_key=counter_key)

    # Pay-per-note: needs wallet balance.
    wallet_snap = _billing_doc(db, org_id, "wallet").get()
    wallet = (
        WalletDoc.model_validate(wallet_snap.to_dict()) if wallet_snap.exists else WalletDoc()
    )
    if wallet.balance_paise < NOTE_CHARGE_PAISE:
        if enforce:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="insufficient_wallet_balance",
            )
        logger.info(
            "billing_gate_wouldblock org=%s reason=insufficient_balance bal=%d (enforce off)",
            org_id, wallet.balance_paise,
        )
        return NoteAllowance(mode="free", reason="payg")
    return NoteAllowance(mode="payg", reason="payg")


def release_note_slot(org_id: str, allowance: NoteAllowance) -> None:
    """Give back a reserved standard-tier slot when the note failed after the
    gate (AI error, storage failure). Best-effort — never raises."""
    if not allowance.reserved_slot_key:
        return
    try:
        from google.cloud.firestore_v1 import Increment

        (
            get_db()
            .collection("organizations")
            .document(org_id)
            .collection("usage_counters")
            .document(allowance.reserved_slot_key)
            .update({"count": Increment(-1)})
        )
    except Exception:
        logger.exception("billing_slot_release_failed org=%s", org_id)


def charge_note(org_id: str, uid: str, recording_id: str, allowance: NoteAllowance) -> None:
    """Debit ₹5 for a payg note AFTER it persisted successfully.

    Transactional; the balance may briefly go below the pre-checked value
    under concurrency, which we accept (never below zero going forward —
    the next check_note_allowance blocks). Never raises: a charge failure
    must not fail the already-saved note; it's logged for reconciliation.
    """
    if allowance.mode != "payg":
        return
    if not _enforcement_on():
        logger.info("billing_charge_skipped org=%s rec=%s (enforce off)", org_id, recording_id)
        return
    try:
        from google.cloud import firestore as gcf

        db = get_db()
        wallet_ref = _billing_doc(db, org_id, "wallet")
        transaction = db.transaction()

        @gcf.transactional
        def _txn(txn):
            snap = wallet_ref.get(transaction=txn)
            wallet = (
                WalletDoc.model_validate(snap.to_dict()) if snap.exists else WalletDoc()
            )
            now = utc_now()
            new_balance = wallet.balance_paise - NOTE_CHARGE_PAISE
            txn.set(
                wallet_ref,
                WalletDoc(balance_paise=new_balance, updated_at=now).model_dump(mode="json"),
            )
            tx = WalletTransaction(
                type="debit",
                amount_paise=NOTE_CHARGE_PAISE,
                balance_after_paise=new_balance,
                reason="note_charge",
                created_by_uid=uid,
                created_at=now,
            )
            txn.set(
                wallet_ref.collection("transactions").document(recording_id),
                tx.model_dump(mode="json"),
            )

        _txn(transaction)
        logger.info("billing_note_charged org=%s rec=%s", org_id, recording_id)
    except Exception:
        logger.exception("billing_note_charge_failed org=%s rec=%s", org_id, recording_id)
