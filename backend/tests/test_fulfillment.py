"""_fulfill_order: idempotency gate + per-clinic subscription routing."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.models.billing import PaymentOrder
from app.models.common import utc_now
from app.routers.billing import (
    SUBSCRIPTION_PERIOD_DAYS,
    TRIAL_DAYS,
    _fulfill_order,
)
from tests.conftest import assert_dt_close


def _seed_order(fake_db, order_id: str, purpose: str, amount_paise: int, clinic_id=None):
    order = PaymentOrder(
        org_id="org1",
        clinic_id=clinic_id,
        purpose=purpose,
        amount_paise=amount_paise,
        created_by_uid="u1",
    )
    fake_db.seed(f"organizations/org1/payments/{order_id}", order.model_dump(mode="json"))


TX_COLL = "organizations/org1/billing/wallet/transactions"


class TestIdempotency:
    def test_double_fulfill_credits_wallet_once(self, fake_db):
        _seed_order(fake_db, "order_t1", "wallet_topup", 10_000)

        p1, bal1, _ = _fulfill_order(
            org_id="org1", order_id="order_t1", payment_id="pay_1", actor_uid="u1"
        )
        # Second call — e.g. the webhook firing after /verify already ran.
        p2, bal2, _ = _fulfill_order(
            org_id="org1", order_id="order_t1", payment_id="pay_dup", actor_uid="u1"
        )

        assert (p1, bal1) == ("wallet_topup", 10_000)
        assert (p2, bal2) == ("wallet_topup", 10_000)
        wallet = fake_db.store["organizations/org1/billing/wallet"]
        assert wallet["balance_paise"] == 10_000  # credited exactly once

        tx_docs = fake_db.docs_under(TX_COLL)
        assert len(tx_docs) == 1  # ledger row written exactly once
        tx = fake_db.store[tx_docs[0]]
        assert tx["type"] == "credit"
        assert tx["amount_paise"] == 10_000
        assert tx["balance_after_paise"] == 10_000
        assert tx["reason"] == "wallet_topup"
        assert tx["razorpay_order_id"] == "order_t1"
        assert tx["razorpay_payment_id"] == "pay_1"  # first fulfillment wins
        # payment_id from the first (winning) fulfillment is kept.
        assert fake_db.store["organizations/org1/payments/order_t1"][
            "razorpay_payment_id"
        ] == "pay_1"

    def test_topup_credits_on_top_of_existing_balance(self, fake_db):
        fake_db.seed("organizations/org1/billing/wallet", {"balance_paise": 2_500})
        _seed_order(fake_db, "order_t2", "wallet_topup", 5_000)
        _, balance, _ = _fulfill_order(
            org_id="org1", order_id="order_t2", payment_id="pay_2", actor_uid="u1"
        )
        assert balance == 7_500
        assert fake_db.store["organizations/org1/billing/wallet"]["balance_paise"] == 7_500

    def test_unknown_order_is_404(self, fake_db):
        with pytest.raises(HTTPException) as ei:
            _fulfill_order(org_id="org1", order_id="nope", payment_id=None, actor_uid=None)
        assert ei.value.status_code == 404
        assert ei.value.detail == "order_not_found"


class TestPerClinicRouting:
    def test_standard_subscription_lands_on_clinic_doc(self, fake_db):
        _seed_order(
            fake_db, "order_s1", "subscription_standard", 49_900, clinic_id="clinic-a"
        )
        purpose, _, sub = _fulfill_order(
            org_id="org1", order_id="order_s1", payment_id="pay_s1", actor_uid="u1"
        )
        assert purpose == "subscription_standard"

        doc = fake_db.store["organizations/org1/billing/subscription_clinic-a"]
        assert doc["tier"] == "standard"
        assert doc["status"] == "active"
        now = utc_now()
        assert_dt_close(doc["current_period_start"], now)
        assert_dt_close(
            doc["current_period_end"], now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
        )
        # The org-level subscription doc is untouched.
        assert "organizations/org1/billing/subscription" not in fake_db.store
        assert sub.tier == "standard" and sub.status == "active"

    def test_premium_subscription_for_other_clinic_is_isolated(self, fake_db):
        _seed_order(
            fake_db, "order_p1", "subscription_premium", 79_900, clinic_id="clinic-b"
        )
        _fulfill_order(org_id="org1", order_id="order_p1", payment_id="pay_p1", actor_uid="u1")
        doc = fake_db.store["organizations/org1/billing/subscription_clinic-b"]
        assert doc["tier"] == "premium"
        assert doc["status"] == "active"
        assert "organizations/org1/billing/subscription_clinic-a" not in fake_db.store

    def test_renewal_extends_from_current_period_end(self, fake_db):
        now = utc_now()
        period_end = now + timedelta(days=10)
        fake_db.seed(
            "organizations/org1/billing/subscription_clinic-a",
            {
                "tier": "standard",
                "status": "active",
                "current_period_start": (now - timedelta(days=20)).isoformat(),
                "current_period_end": period_end.isoformat(),
            },
        )
        _seed_order(
            fake_db, "order_s2", "subscription_standard", 49_900, clinic_id="clinic-a"
        )
        _fulfill_order(org_id="org1", order_id="order_s2", payment_id="pay_s2", actor_uid="u1")
        doc = fake_db.store["organizations/org1/billing/subscription_clinic-a"]
        assert_dt_close(
            doc["current_period_end"], period_end + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
        )

    def test_joining_fee_writes_org_level_trial(self, fake_db):
        _seed_order(fake_db, "order_j1", "joining_fee", 50_000, clinic_id=None)
        purpose, _, sub = _fulfill_order(
            org_id="org1", order_id="order_j1", payment_id="pay_j1", actor_uid="u1"
        )
        assert purpose == "joining_fee"

        doc = fake_db.store["organizations/org1/billing/subscription"]
        assert doc["joining_fee_paid"] is True
        assert doc["status"] == "trial"
        assert doc["tier"] == "payg"  # "none" upgraded to payg
        assert_dt_close(doc["trial_ends_at"], utc_now() + timedelta(days=TRIAL_DAYS))
        # No clinic doc created by the joining fee.
        assert not any(
            p.startswith("organizations/org1/billing/subscription_")
            for p in fake_db.store
        )
        assert sub.joining_fee_paid is True and sub.status == "trial"
