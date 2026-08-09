"""Razorpay payments: wallet top-ups, joining fee, and subscription purchases.

Flow (Razorpay "Standard Checkout" for React Native):
  1. App calls POST /billing/orders → backend creates a Razorpay Order with a
     server-decided amount (client never picks plan prices) and returns
     {order_id, amount_paise, key_id}.
  2. App opens Razorpay checkout with that order_id; on success it receives
     {razorpay_order_id, razorpay_payment_id, razorpay_signature}.
  3. App calls POST /billing/verify → backend checks the HMAC signature with
     the key secret and fulfills (credit wallet / activate plan). Idempotent.
  4. Razorpay also calls POST /billing/webhook (payment.captured) — the same
     idempotent fulfillment, so a killed app can't lose a paid order.

Money is integer paise everywhere. Pricing lives HERE, server-side only.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth.deps import OwnerDep
from app.models.billing import (
    PaymentOrder,
    PaymentPurpose,
    SubscriptionDoc,
    WalletDoc,
    WalletTransaction,
)
from app.models.common import utc_now
from app.services.app_config import RazorpayConfig, get_razorpay_config
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

# ─── Pricing — imported from the single source of truth ────────────

from app.services.pricing import (  # noqa: E402
    JOINING_FEE_PAISE,
    MAX_TOPUP_PAISE,
    MIN_TOPUP_PAISE,
    PER_NOTE_PAISE,
    PREMIUM_MONTHLY_PAISE,
    STANDARD_MONTHLY_PAISE,
    SUBSCRIPTION_PERIOD_DAYS,
    TRIAL_DAYS,
)

PLANS = [
    {
        "id": "payg",
        "name": "Pay-Per-Note",
        "badge": "TOP-UP",
        "price_label": "₹5 / note",
        "amount_paise": None,  # wallet top-up, user picks amount
        "per_note_paise": PER_NOTE_PAISE,
        "backup": "3 months cloud backup",
        "features": ["Core voice-to-SOAP note generation", "Standard PDF export"],
    },
    {
        "id": "standard",
        "name": "Standard Package",
        "badge": "POPULAR",
        "price_label": "₹499 / month / clinic",
        "amount_paise": STANDARD_MONTHLY_PAISE,
        "limit_label": "Up to 30 cases / day",
        "backup": "6 months cloud backup",
        "features": [
            "Smart gesture inputs",
            "Backend-verified doctor badge",
            "In-app patient follow-up reminders",
        ],
    },
    {
        "id": "premium",
        "name": "Premium Package",
        "badge": "UNLIMITED",
        "price_label": "₹799 / month / clinic",
        "amount_paise": PREMIUM_MONTHLY_PAISE,
        "limit_label": "Unlimited PDF generation",
        "backup": "1 year cloud backup",
        "features": [
            "Smart gesture inputs",
            "Verified badge printed on every PDF",
            "Daily & monthly case tracking dashboard",
            "Real-time live weather updates",
            "In-app patient follow-up reminders",
        ],
    },
]

_PURPOSE_AMOUNT: dict[str, int | None] = {
    "wallet_topup": None,  # caller-supplied within bounds
    "joining_fee": JOINING_FEE_PAISE,
    "subscription_standard": STANDARD_MONTHLY_PAISE,
    "subscription_premium": PREMIUM_MONTHLY_PAISE,
}


# ─── Razorpay client ───────────────────────────────────────────────


def _require_config() -> RazorpayConfig:
    """Keys live in Firestore app_config/razorpay (backend-only), env fallback."""
    cfg = get_razorpay_config()
    if not cfg.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="payments_not_configured",
        )
    return cfg


def _razorpay_client(cfg: RazorpayConfig):
    import razorpay  # lazy import so the backend boots without the SDK configured

    return razorpay.Client(auth=(cfg.key_id, cfg.key_secret))


# ─── Firestore refs ────────────────────────────────────────────────


def _org_ref(db, org_id: str):
    return db.collection("organizations").document(org_id)


def _wallet_ref(db, org_id: str):
    return _org_ref(db, org_id).collection("billing").document("wallet")


def _subscription_ref(db, org_id: str):
    """Org-level doc: joining fee + trial state (account onboarding)."""
    return _org_ref(db, org_id).collection("billing").document("subscription")


def _clinic_subscription_ref(db, org_id: str, clinic_id: str):
    """Per-clinic paid tier — each clinic branch buys its own plan."""
    return _org_ref(db, org_id).collection("billing").document(f"subscription_{clinic_id}")


def _payment_ref(db, org_id: str, order_id: str):
    return _org_ref(db, org_id).collection("payments").document(order_id)


# ─── Shapes ────────────────────────────────────────────────────────


class WalletResponse(BaseModel):
    balance_paise: int
    currency: str
    subscription: SubscriptionDoc
    transactions: list[WalletTransaction]


class CreateOrderRequest(BaseModel):
    purpose: PaymentPurpose
    # Only for wallet_topup; ignored otherwise. Rupees for client convenience.
    amount_inr: Optional[int] = Field(None, ge=1)


class CreateOrderResponse(BaseModel):
    order_id: str
    amount_paise: int
    currency: str
    key_id: str  # public key id, needed by the checkout SDK
    purpose: PaymentPurpose


class VerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class VerifyResponse(BaseModel):
    status: str  # "paid"
    purpose: PaymentPurpose
    wallet_balance_paise: int
    subscription: SubscriptionDoc


def _effective_subscription(db, org_id: str, clinic_id: str | None) -> SubscriptionDoc:
    """The caller-visible subscription: the active clinic's paid tier, with
    org-level joining-fee/trial state merged in (trial covers all clinics)."""
    org_snap = _subscription_ref(db, org_id).get()
    org_sub = (
        SubscriptionDoc.model_validate(org_snap.to_dict()) if org_snap.exists else SubscriptionDoc()
    )
    clinic_sub = SubscriptionDoc()
    if clinic_id:
        c_snap = _clinic_subscription_ref(db, org_id, clinic_id).get()
        if c_snap.exists:
            clinic_sub = SubscriptionDoc.model_validate(c_snap.to_dict())
    merged = clinic_sub.model_copy(
        update={
            "joining_fee_paid": org_sub.joining_fee_paid,
            "trial_ends_at": org_sub.trial_ends_at,
        }
    )
    now = utc_now()
    if (
        merged.status == "inactive"
        and org_sub.status == "trial"
        and org_sub.trial_ends_at
        and org_sub.trial_ends_at > now
    ):
        merged = merged.model_copy(update={"status": "trial"})
    return merged


# ─── Endpoints ─────────────────────────────────────────────────────


@router.get("/plans")
def get_plans() -> dict[str, object]:
    """Public plan matrix — safe to expose, contains only list prices."""
    return {
        "joining_fee_paise": JOINING_FEE_PAISE,
        "trial_days": TRIAL_DAYS,
        "per_note_paise": PER_NOTE_PAISE,
        "plans": PLANS,
    }


@router.get("/wallet", response_model=WalletResponse)
def get_wallet(user: OwnerDep) -> WalletResponse:
    # Owner-only, mirroring firestore.rules: staff accounts must not see the
    # org's balance, plan, or Razorpay transaction ids.
    db = get_db()
    wallet_snap = _wallet_ref(db, user.org_id).get()
    wallet = (
        WalletDoc.model_validate(wallet_snap.to_dict()) if wallet_snap.exists else WalletDoc()
    )
    sub = _effective_subscription(db, user.org_id, user.active_clinic_id)
    tx_snaps = (
        _wallet_ref(db, user.org_id)
        .collection("transactions")
        .order_by("created_at", direction="DESCENDING")
        .limit(25)
        .stream()
    )
    txs = []
    for snap in tx_snaps:
        try:
            txs.append(WalletTransaction.model_validate(snap.to_dict()))
        except Exception:
            logger.warning("skipping_invalid_wallet_tx id=%s", snap.id)
    return WalletResponse(
        balance_paise=wallet.balance_paise,
        currency=wallet.currency,
        subscription=sub,
        transactions=txs,
    )


@router.post("/orders", response_model=CreateOrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(body: CreateOrderRequest, user: OwnerDep) -> CreateOrderResponse:
    """Create a Razorpay order. Amounts are decided server-side."""
    fixed = _PURPOSE_AMOUNT[body.purpose]
    if fixed is not None:
        amount_paise = fixed
    else:
        if body.amount_inr is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="amount_required"
            )
        amount_paise = body.amount_inr * 100
        if not (MIN_TOPUP_PAISE <= amount_paise <= MAX_TOPUP_PAISE):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="amount_out_of_range"
            )

    # Subscriptions are charged per clinic — the buyer's active clinic.
    clinic_id = (
        user.active_clinic_id
        if body.purpose in ("subscription_standard", "subscription_premium")
        else None
    )

    cfg = _require_config()
    client = _razorpay_client(cfg)
    try:
        rzp_order = client.order.create(
            {
                "amount": amount_paise,
                "currency": "INR",
                "notes": {
                    "org_id": user.org_id,
                    "clinic_id": clinic_id or "",
                    "purpose": body.purpose,
                    "uid": user.uid,
                },
            }
        )
    except Exception as e:
        logger.exception("razorpay_order_create_failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="payment_gateway_error"
        ) from e

    order_id = rzp_order["id"]
    db = get_db()
    order = PaymentOrder(
        org_id=user.org_id,
        clinic_id=clinic_id,
        purpose=body.purpose,
        amount_paise=amount_paise,
        created_by_uid=user.uid,
    )
    _payment_ref(db, user.org_id, order_id).set(order.model_dump(mode="json"))
    logger.info(
        "billing_order_created order=%s org=%s purpose=%s amount=%d",
        order_id, user.org_id, body.purpose, amount_paise,
    )
    return CreateOrderResponse(
        order_id=order_id,
        amount_paise=amount_paise,
        currency="INR",
        key_id=cfg.key_id,
        purpose=body.purpose,
    )


@router.post("/verify", response_model=VerifyResponse)
def verify_payment(body: VerifyRequest, user: OwnerDep) -> VerifyResponse:
    """Verify the checkout signature and fulfill the order (idempotent)."""
    cfg = _require_config()
    expected = hmac.new(
        cfg.key_secret.encode(),
        f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        logger.warning("billing_signature_mismatch order=%s", body.razorpay_order_id)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_payment_signature"
        )

    purpose, balance, sub = _fulfill_order(
        org_id=user.org_id,
        order_id=body.razorpay_order_id,
        payment_id=body.razorpay_payment_id,
        actor_uid=user.uid,
    )
    return VerifyResponse(
        status="paid", purpose=purpose, wallet_balance_paise=balance, subscription=sub
    )


@router.post("/webhook", include_in_schema=False)
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Annotated[Optional[str], Header()] = None,
) -> dict[str, str]:
    """Razorpay server-to-server events. Auth = webhook signature, not a user."""
    cfg = get_razorpay_config()
    if not cfg.webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="payments_not_configured",
        )
    raw = await request.body()
    expected = hmac.new(cfg.webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not x_razorpay_signature or not hmac.compare_digest(expected, x_razorpay_signature):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_webhook_signature"
        )

    import json

    event = json.loads(raw)
    event_type = event.get("event")
    payment = (
        event.get("payload", {}).get("payment", {}).get("entity", {})
        if isinstance(event.get("payload"), dict)
        else {}
    )
    order_id = payment.get("order_id")
    notes = payment.get("notes") or {}
    org_id = notes.get("org_id")

    if event_type == "payment.captured" and order_id and org_id:
        try:
            _fulfill_order(
                org_id=org_id,
                order_id=order_id,
                payment_id=payment.get("id"),
                actor_uid=notes.get("uid"),
            )
        except HTTPException as e:
            # order_not_found etc. — log and ack so Razorpay stops retrying
            logger.warning(
                "billing_webhook_fulfill_skipped order=%s detail=%s", order_id, e.detail
            )
    elif event_type == "payment.failed" and order_id and org_id:
        db = get_db()
        ref = _payment_ref(db, org_id, order_id)
        snap = ref.get()
        if snap.exists and (snap.to_dict() or {}).get("status") == "created":
            ref.update({"status": "failed", "updated_at": utc_now().isoformat()})
    return {"status": "ok"}


# ─── Fulfillment (shared by /verify and webhook; idempotent) ───────


def _fulfill_order(
    org_id: str, order_id: str, payment_id: str | None, actor_uid: str | None
) -> tuple[PaymentPurpose, int, SubscriptionDoc]:
    """Mark the order paid and apply its effect exactly once.

    Runs in a Firestore transaction: the payment doc's status flip from
    "created" → "paid" is the idempotency gate, so /verify and the webhook
    can both fire without double-crediting.
    """
    from google.cloud import firestore as gcf

    db = get_db()
    payment_ref = _payment_ref(db, org_id, order_id)
    wallet_ref = _wallet_ref(db, org_id)
    sub_ref = _subscription_ref(db, org_id)

    transaction = db.transaction()

    @gcf.transactional
    def _txn(txn):
        pay_snap = payment_ref.get(transaction=txn)
        if not pay_snap.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="order_not_found"
            )
        order = PaymentOrder.model_validate(pay_snap.to_dict())
        wallet_snap = wallet_ref.get(transaction=txn)
        wallet = (
            WalletDoc.model_validate(wallet_snap.to_dict())
            if wallet_snap.exists
            else WalletDoc()
        )
        # Per-clinic billing: subscription purchases land on the buying
        # clinic's doc; the joining fee stays on the org-level doc.
        if order.purpose in ("subscription_standard", "subscription_premium") and order.clinic_id:
            target_sub_ref = _clinic_subscription_ref(db, org_id, order.clinic_id)
        else:
            target_sub_ref = sub_ref
        sub_snap = target_sub_ref.get(transaction=txn)
        sub = (
            SubscriptionDoc.model_validate(sub_snap.to_dict())
            if sub_snap.exists
            else SubscriptionDoc()
        )

        if order.status == "paid":
            return order.purpose, wallet.balance_paise, sub  # already fulfilled

        now = utc_now()
        txn.update(
            payment_ref,
            {
                "status": "paid",
                "razorpay_payment_id": payment_id,
                "updated_at": now.isoformat(),
            },
        )

        if order.purpose == "wallet_topup":
            new_balance = wallet.balance_paise + order.amount_paise
            txn.set(
                wallet_ref,
                WalletDoc(balance_paise=new_balance, updated_at=now).model_dump(mode="json"),
            )
            tx = WalletTransaction(
                type="credit",
                amount_paise=order.amount_paise,
                balance_after_paise=new_balance,
                reason="wallet_topup",
                razorpay_payment_id=payment_id,
                razorpay_order_id=order_id,
                created_by_uid=actor_uid,
                created_at=now,
            )
            txn.set(
                wallet_ref.collection("transactions").document(),
                tx.model_dump(mode="json"),
            )
            wallet = WalletDoc(balance_paise=new_balance, updated_at=now)
        elif order.purpose == "joining_fee":
            sub = sub.model_copy(
                update={
                    "joining_fee_paid": True,
                    "status": "trial",
                    "tier": sub.tier if sub.tier != "none" else "payg",
                    "trial_ends_at": now + timedelta(days=TRIAL_DAYS),
                    "updated_at": now,
                }
            )
            txn.set(target_sub_ref, sub.model_dump(mode="json"))
        else:  # subscription_standard / subscription_premium
            tier = "standard" if order.purpose == "subscription_standard" else "premium"
            # Extend from the current period end if still active, else from now.
            base = (
                sub.current_period_end
                if sub.current_period_end and sub.current_period_end > now and sub.tier == tier
                else now
            )
            sub = sub.model_copy(
                update={
                    "tier": tier,
                    "status": "active",
                    "current_period_start": now,
                    "current_period_end": base + timedelta(days=SUBSCRIPTION_PERIOD_DAYS),
                    "updated_at": now,
                }
            )
            txn.set(target_sub_ref, sub.model_dump(mode="json"))

        return order.purpose, wallet.balance_paise, sub

    purpose, balance, sub = _txn(transaction)
    logger.info(
        "billing_order_fulfilled order=%s org=%s purpose=%s", order_id, org_id, purpose
    )
    return purpose, balance, sub
