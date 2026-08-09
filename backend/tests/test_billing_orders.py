"""create_order: server-side pricing is authoritative; top-up bounds enforced."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers.billing import (
    JOINING_FEE_PAISE,
    MAX_TOPUP_PAISE,
    MIN_TOPUP_PAISE,
    PREMIUM_MONTHLY_PAISE,
    STANDARD_MONTHLY_PAISE,
    CreateOrderRequest,
    create_order,
)
from tests.conftest import make_user


def _order(purpose: str, amount_inr: int | None = None) -> CreateOrderRequest:
    return CreateOrderRequest(purpose=purpose, amount_inr=amount_inr)


class TestWalletTopupValidation:
    def test_topup_without_amount_is_400(self, owner):
        with pytest.raises(HTTPException) as ei:
            create_order(_order("wallet_topup"), owner)
        assert ei.value.status_code == 400
        assert ei.value.detail == "amount_required"

    @pytest.mark.parametrize("amount_inr", [1, 49, 50_001, 1_000_000])
    def test_topup_out_of_range_is_400(self, owner, amount_inr):
        with pytest.raises(HTTPException) as ei:
            create_order(_order("wallet_topup", amount_inr), owner)
        assert ei.value.status_code == 400
        assert ei.value.detail == "amount_out_of_range"

    @pytest.mark.parametrize(
        "amount_inr,expected_paise",
        [(50, MIN_TOPUP_PAISE), (100, 10_000), (50_000, MAX_TOPUP_PAISE)],
    )
    def test_topup_in_range_uses_client_amount(
        self, fake_db, rzp_config, rzp_orders, owner, amount_inr, expected_paise
    ):
        resp = create_order(_order("wallet_topup", amount_inr), owner)
        assert resp.amount_paise == expected_paise
        assert rzp_orders[0]["amount"] == expected_paise
        stored = fake_db.store[f"organizations/org1/payments/{resp.order_id}"]
        assert stored["amount_paise"] == expected_paise
        assert stored["clinic_id"] is None  # top-ups are org-level


class TestFixedPurposePricing:
    """Client-supplied amount_inr must be ignored for fixed-price purposes."""

    @pytest.mark.parametrize(
        "purpose,expected_paise",
        [
            ("joining_fee", JOINING_FEE_PAISE),
            ("subscription_standard", STANDARD_MONTHLY_PAISE),
            ("subscription_premium", PREMIUM_MONTHLY_PAISE),
        ],
    )
    def test_amount_is_server_constant(
        self, fake_db, rzp_config, rzp_orders, owner, purpose, expected_paise
    ):
        # Malicious/buggy client sends ₹1 — server must charge list price.
        resp = create_order(_order(purpose, amount_inr=1), owner)
        assert resp.amount_paise == expected_paise
        assert resp.order_id == "order_test1"
        assert resp.key_id == "rzp_test_key"
        assert rzp_orders[0]["amount"] == expected_paise
        stored = fake_db.store[f"organizations/org1/payments/{resp.order_id}"]
        assert stored["amount_paise"] == expected_paise
        assert stored["purpose"] == purpose
        assert stored["status"] == "created"
        assert stored["org_id"] == "org1"
        assert stored["created_by_uid"] == "u1"

    def test_subscription_orders_carry_buyers_clinic(
        self, fake_db, rzp_config, rzp_orders, owner
    ):
        resp = create_order(_order("subscription_standard"), owner)
        stored = fake_db.store[f"organizations/org1/payments/{resp.order_id}"]
        assert stored["clinic_id"] == "clinic-a"
        assert rzp_orders[0]["notes"]["clinic_id"] == "clinic-a"

    def test_joining_fee_is_org_level(self, fake_db, rzp_config, rzp_orders, owner):
        resp = create_order(_order("joining_fee"), owner)
        stored = fake_db.store[f"organizations/org1/payments/{resp.order_id}"]
        assert stored["clinic_id"] is None

    def test_unconfigured_gateway_is_503(self, fake_db, monkeypatch, owner):
        from app.services.app_config import RazorpayConfig

        monkeypatch.setattr(
            "app.routers.billing.get_razorpay_config",
            lambda: RazorpayConfig(key_id="", key_secret="", webhook_secret=""),
        )
        with pytest.raises(HTTPException) as ei:
            create_order(_order("joining_fee"), make_user())
        assert ei.value.status_code == 503
        assert ei.value.detail == "payments_not_configured"
