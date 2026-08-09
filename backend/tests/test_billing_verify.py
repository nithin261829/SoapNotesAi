"""verify_payment: HMAC signature check + fulfillment wiring."""
from __future__ import annotations

import hashlib
import hmac

import pytest
from fastapi import HTTPException

from app.models.billing import PaymentOrder
from app.routers.billing import VerifyRequest, verify_payment


def _sign(secret: str, order_id: str, payment_id: str) -> str:
    return hmac.new(
        secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()


def _seed_topup_order(fake_db, order_id: str, amount_paise: int = 10_000) -> None:
    order = PaymentOrder(
        org_id="org1",
        clinic_id=None,
        purpose="wallet_topup",
        amount_paise=amount_paise,
        created_by_uid="u1",
    )
    fake_db.seed(f"organizations/org1/payments/{order_id}", order.model_dump(mode="json"))


def test_correct_signature_accepted_and_fulfilled(fake_db, rzp_config, owner):
    _seed_topup_order(fake_db, "order_1", amount_paise=10_000)
    body = VerifyRequest(
        razorpay_order_id="order_1",
        razorpay_payment_id="pay_1",
        razorpay_signature=_sign("test_secret", "order_1", "pay_1"),
    )
    resp = verify_payment(body, owner)
    assert resp.status == "paid"
    assert resp.purpose == "wallet_topup"
    assert resp.wallet_balance_paise == 10_000
    payment = fake_db.store["organizations/org1/payments/order_1"]
    assert payment["status"] == "paid"
    assert payment["razorpay_payment_id"] == "pay_1"


def test_wrong_signature_is_400(fake_db, rzp_config, owner):
    _seed_topup_order(fake_db, "order_1")
    body = VerifyRequest(
        razorpay_order_id="order_1",
        razorpay_payment_id="pay_1",
        razorpay_signature="deadbeef" * 8,
    )
    with pytest.raises(HTTPException) as ei:
        verify_payment(body, owner)
    assert ei.value.status_code == 400
    assert ei.value.detail == "invalid_payment_signature"
    # Nothing fulfilled.
    assert fake_db.store["organizations/org1/payments/order_1"]["status"] == "created"
    assert "organizations/org1/billing/wallet" not in fake_db.store


def test_signature_with_wrong_secret_is_400(fake_db, rzp_config, owner):
    _seed_topup_order(fake_db, "order_1")
    body = VerifyRequest(
        razorpay_order_id="order_1",
        razorpay_payment_id="pay_1",
        razorpay_signature=_sign("attacker_secret", "order_1", "pay_1"),
    )
    with pytest.raises(HTTPException) as ei:
        verify_payment(body, owner)
    assert ei.value.status_code == 400
    assert ei.value.detail == "invalid_payment_signature"


def test_unconfigured_keys_is_503(fake_db, monkeypatch, owner):
    from app.services.app_config import RazorpayConfig

    monkeypatch.setattr(
        "app.routers.billing.get_razorpay_config",
        lambda: RazorpayConfig(key_id="", key_secret="", webhook_secret=""),
    )
    body = VerifyRequest(
        razorpay_order_id="order_1",
        razorpay_payment_id="pay_1",
        razorpay_signature=_sign("test_secret", "order_1", "pay_1"),
    )
    with pytest.raises(HTTPException) as ei:
        verify_payment(body, owner)
    assert ei.value.status_code == 503
    assert ei.value.detail == "payments_not_configured"
