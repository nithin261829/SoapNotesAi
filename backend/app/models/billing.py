"""Billing state: prepaid wallet, subscription, and Razorpay payment orders.

Firestore layout (all writes go through the backend; clients read wallet +
subscription via the API or read-only rules):

    organizations/{orgId}/billing/wallet                     ← WalletDoc
    organizations/{orgId}/billing/wallet/transactions/{txId} ← WalletTransaction
    organizations/{orgId}/billing/subscription               ← SubscriptionDoc
    organizations/{orgId}/payments/{razorpayOrderId}         ← PaymentOrder (backend-only)

All money amounts are integer paise (₹1 = 100 paise) — never floats.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.common import FirestoreModel, utc_now

PaymentPurpose = Literal[
    "wallet_topup",
    "joining_fee",
    "subscription_standard",
    "subscription_premium",
]

SubscriptionTier = Literal["none", "payg", "standard", "premium"]


class WalletDoc(FirestoreModel):
    balance_paise: int = 0
    currency: str = "INR"
    updated_at: datetime = Field(default_factory=utc_now)


class WalletTransaction(FirestoreModel):
    type: Literal["credit", "debit"]
    amount_paise: int
    balance_after_paise: int
    reason: str  # e.g. "wallet_topup", "note_charge", "letterhead_change"
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    created_by_uid: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class SubscriptionDoc(FirestoreModel):
    tier: SubscriptionTier = "none"
    status: Literal["inactive", "trial", "active", "expired"] = "inactive"
    joining_fee_paid: bool = False
    trial_ends_at: Optional[datetime] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    updated_at: datetime = Field(default_factory=utc_now)


class PaymentOrder(FirestoreModel):
    """One doc per Razorpay order, keyed by the Razorpay order id."""

    org_id: str
    # Subscriptions are sold PER CLINIC (user decision 2026-08-09): the buyer's
    # active clinic at order time. None for org-level purchases (top-up, fee).
    clinic_id: Optional[str] = None
    purpose: PaymentPurpose
    amount_paise: int
    currency: str = "INR"
    status: Literal["created", "paid", "failed"] = "created"
    razorpay_payment_id: Optional[str] = None
    created_by_uid: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
