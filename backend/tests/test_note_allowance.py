"""check_note_allowance tier matrix + charge_note wallet debits."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.models.common import utc_now
from app.services.billing_service import (
    NOTE_CHARGE_PAISE,
    STANDARD_DAILY_CASE_LIMIT,
    NoteAllowance,
    charge_note,
    check_note_allowance,
)

ORG = "org1"
CLINIC = "clinic-a"
SUB_CLINIC = f"organizations/{ORG}/billing/subscription_{CLINIC}"
SUB_ORG = f"organizations/{ORG}/billing/subscription"
WALLET = f"organizations/{ORG}/billing/wallet"
TX_COLL = f"{WALLET}/transactions"


@pytest.fixture
def enforce_on(set_config):
    set_config("billing", {"enforce": True})


def _seed_clinic_sub(fake_db, tier: str, days_left: int = 20):
    fake_db.seed(
        SUB_CLINIC,
        {
            "tier": tier,
            "status": "active",
            "current_period_end": (utc_now() + timedelta(days=days_left)).isoformat(),
        },
    )


def _counter_key(clinic_id: str = CLINIC) -> str:
    from app.services.billing_service import _ist_day_key

    return f"{clinic_id}_{_ist_day_key()}"


def _seed_usage(fake_db, count: int, clinic_id: str = CLINIC):
    """Standard-cap accounting is a transactional per-clinic per-IST-day
    counter doc (race-proof reservation), not a usage-doc scan."""
    fake_db.seed(
        f"organizations/{ORG}/usage_counters/{_counter_key(clinic_id)}",
        {"count": count, "clinic_id": clinic_id},
    )


class TestAllowanceMatrix:
    def test_premium_active_is_free(self, fake_db, enforce_on):
        _seed_clinic_sub(fake_db, "premium")
        allowance = check_note_allowance(ORG, CLINIC)
        assert allowance == NoteAllowance(mode="free", reason="premium")

    def test_org_trial_is_free_for_all_clinics(self, fake_db, enforce_on):
        fake_db.seed(
            SUB_ORG,
            {
                "status": "trial",
                "joining_fee_paid": True,
                "trial_ends_at": (utc_now() + timedelta(days=3)).isoformat(),
            },
        )
        assert check_note_allowance(ORG, CLINIC) == NoteAllowance(mode="free", reason="trial")
        assert check_note_allowance(ORG, "clinic-b") == NoteAllowance(
            mode="free", reason="trial"
        )

    def test_standard_at_daily_cap_is_429(self, fake_db, enforce_on):
        _seed_clinic_sub(fake_db, "standard")
        _seed_usage(fake_db, STANDARD_DAILY_CASE_LIMIT)  # 30 notes today, same clinic
        with pytest.raises(HTTPException) as ei:
            check_note_allowance(ORG, CLINIC)
        assert ei.value.status_code == 429
        assert ei.value.detail == "daily_case_limit_reached"

    def test_standard_under_cap_is_free_and_reserves_slot(self, fake_db, enforce_on):
        _seed_clinic_sub(fake_db, "standard")
        _seed_usage(fake_db, 5)
        allowance = check_note_allowance(ORG, CLINIC)
        assert allowance.mode == "free" and allowance.reason == "standard"
        assert allowance.reserved_slot_key == _counter_key()
        # The slot was reserved atomically: counter incremented 5 → 6.
        counter = fake_db.store[f"organizations/{ORG}/usage_counters/{_counter_key()}"]
        assert counter["count"] == 6

    def test_standard_cap_counts_only_this_clinic(self, fake_db, enforce_on):
        _seed_clinic_sub(fake_db, "standard")
        _seed_usage(fake_db, STANDARD_DAILY_CASE_LIMIT, clinic_id="clinic-b")  # other clinic
        _seed_usage(fake_db, 3)  # ours, well under cap
        allowance = check_note_allowance(ORG, CLINIC)
        assert allowance.mode == "free" and allowance.reason == "standard"

    def test_no_plan_empty_wallet_is_402(self, fake_db, enforce_on):
        with pytest.raises(HTTPException) as ei:
            check_note_allowance(ORG, CLINIC)
        assert ei.value.status_code == 402
        assert ei.value.detail == "insufficient_wallet_balance"

    def test_no_plan_with_balance_is_payg(self, fake_db, enforce_on):
        fake_db.seed(WALLET, {"balance_paise": NOTE_CHARGE_PAISE})  # exactly ₹5
        assert check_note_allowance(ORG, CLINIC) == NoteAllowance(mode="payg", reason="payg")

    def test_expired_clinic_subscription_falls_through_to_payg(self, fake_db, enforce_on):
        _seed_clinic_sub(fake_db, "premium", days_left=-1)  # period ended yesterday
        fake_db.seed(WALLET, {"balance_paise": 10_000})
        assert check_note_allowance(ORG, CLINIC) == NoteAllowance(mode="payg", reason="payg")

    def test_enforcement_off_empty_wallet_is_log_only_free(self, fake_db, set_config):
        set_config("billing", {"enforce": False})
        assert check_note_allowance(ORG, CLINIC) == NoteAllowance(mode="free", reason="payg")

    def test_enforcement_defaults_off_when_config_missing(self, fake_db):
        # No app_config/billing doc at all → enforce defaults to False.
        assert check_note_allowance(ORG, CLINIC) == NoteAllowance(mode="free", reason="payg")


class TestChargeNote:
    def test_payg_charge_debits_wallet_and_writes_ledger(self, fake_db, enforce_on):
        fake_db.seed(WALLET, {"balance_paise": 1_000})
        charge_note(ORG, "u1", "rec1", NoteAllowance(mode="payg", reason="payg"))

        assert fake_db.store[WALLET]["balance_paise"] == 1_000 - NOTE_CHARGE_PAISE
        tx = fake_db.store[f"{TX_COLL}/rec1"]
        assert tx["type"] == "debit"
        assert tx["amount_paise"] == NOTE_CHARGE_PAISE
        assert tx["balance_after_paise"] == 500
        assert tx["reason"] == "note_charge"
        assert tx["created_by_uid"] == "u1"

    def test_same_recording_id_overwrites_same_ledger_doc(self, fake_db, enforce_on):
        fake_db.seed(WALLET, {"balance_paise": 1_000})
        allowance = NoteAllowance(mode="payg", reason="payg")
        charge_note(ORG, "u1", "rec1", allowance)
        charge_note(ORG, "u1", "rec1", allowance)

        # Ledger stays keyed by recording_id — exactly one doc, no duplicates.
        assert fake_db.docs_under(TX_COLL) == [f"{TX_COLL}/rec1"]
        assert fake_db.store[WALLET]["balance_paise"] == 0
        assert fake_db.store[f"{TX_COLL}/rec1"]["balance_after_paise"] == 0

    def test_free_mode_is_noop(self, fake_db, enforce_on):
        fake_db.seed(WALLET, {"balance_paise": 1_000})
        charge_note(ORG, "u1", "rec1", NoteAllowance(mode="free", reason="premium"))
        assert fake_db.store[WALLET]["balance_paise"] == 1_000
        assert fake_db.docs_under(TX_COLL) == []

    def test_enforcement_off_skips_charge(self, fake_db, set_config):
        set_config("billing", {"enforce": False})
        fake_db.seed(WALLET, {"balance_paise": 1_000})
        charge_note(ORG, "u1", "rec1", NoteAllowance(mode="payg", reason="payg"))
        assert fake_db.store[WALLET]["balance_paise"] == 1_000
        assert fake_db.docs_under(TX_COLL) == []
