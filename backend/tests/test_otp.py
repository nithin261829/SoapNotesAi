"""OTP lifecycle: request rate limit, verify expiry/attempts/locking, session stamp."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.models.common import utc_now
from app.services.otp import (
    OTP_MAX_ATTEMPTS,
    OTP_MAX_SENDS_PER_HOUR,
    OTP_SESSION_DAYS,
    is_otp_verified,
    request_otp,
    verify_otp,
)
from tests.conftest import assert_dt_close

UID = "u1"
CHALLENGE = f"otp_challenges/{UID}"
USER_DOC = f"users/{UID}"


@pytest.fixture
def user_doc(fake_db):
    fake_db.seed(USER_DOC, {"email": "doc@example.com"})


def _wrong(code: str) -> str:
    return "000000" if code != "000000" else "111111"


class TestRequestVerifyHappyPath:
    def test_verify_correct_code_stamps_session(self, fake_db, otp_codes, user_doc):
        resp = request_otp(UID, "doc@example.com", None)
        assert resp["channel"] == "email"
        assert resp["sent_to"] == "do***@example.com"  # masked, never the raw address
        assert len(otp_codes) == 1 and len(otp_codes[0]) == 6

        verify_otp(UID, otp_codes[0])

        stamped = fake_db.store[USER_DOC]["otp_verified_until"]
        assert_dt_close(stamped, utc_now() + timedelta(days=OTP_SESSION_DAYS))
        assert CHALLENGE not in fake_db.store  # challenge consumed
        assert is_otp_verified(UID) is True

    def test_verify_tolerates_whitespace(self, fake_db, otp_codes, user_doc):
        request_otp(UID, "doc@example.com", None)
        verify_otp(UID, f"  {otp_codes[0]}  ")
        assert is_otp_verified(UID) is True

    def test_verify_without_request_is_400(self, fake_db):
        with pytest.raises(HTTPException) as ei:
            verify_otp(UID, "123456")
        assert ei.value.status_code == 400
        assert ei.value.detail == "otp_not_requested"


class TestVerifyFailures:
    def test_five_wrong_attempts_locks_challenge(self, fake_db, otp_codes, user_doc):
        request_otp(UID, "doc@example.com", None)
        wrong = _wrong(otp_codes[0])

        for _ in range(OTP_MAX_ATTEMPTS):
            with pytest.raises(HTTPException) as ei:
                verify_otp(UID, wrong)
            assert ei.value.status_code == 400
            assert ei.value.detail == "otp_incorrect"

        # Even the CORRECT code is refused once locked.
        with pytest.raises(HTTPException) as ei:
            verify_otp(UID, otp_codes[0])
        assert ei.value.status_code == 429
        assert ei.value.detail == "otp_locked"
        assert is_otp_verified(UID) is False

    def test_expired_code_is_400(self, fake_db, otp_codes, user_doc):
        request_otp(UID, "doc@example.com", None)
        fake_db.store[CHALLENGE]["expires_at"] = (
            utc_now() - timedelta(minutes=1)
        ).isoformat()
        with pytest.raises(HTTPException) as ei:
            verify_otp(UID, otp_codes[0])
        assert ei.value.status_code == 400
        assert ei.value.detail == "otp_expired"


class TestRateLimit:
    def test_sixth_request_within_hour_is_429(self, fake_db, otp_codes):
        for _ in range(OTP_MAX_SENDS_PER_HOUR):
            request_otp(UID, "doc@example.com", None)
        with pytest.raises(HTTPException) as ei:
            request_otp(UID, "doc@example.com", None)
        assert ei.value.status_code == 429
        assert ei.value.detail == "otp_rate_limited"
        assert len(otp_codes) == OTP_MAX_SENDS_PER_HOUR  # nothing delivered on the 6th

    def test_window_resets_after_an_hour(self, fake_db, otp_codes):
        for _ in range(OTP_MAX_SENDS_PER_HOUR):
            request_otp(UID, "doc@example.com", None)
        # Age the window past one hour.
        fake_db.store[CHALLENGE]["window_start"] = (
            utc_now() - timedelta(hours=2)
        ).isoformat()
        request_otp(UID, "doc@example.com", None)  # allowed again
        assert fake_db.store[CHALLENGE]["window_sends"] == 1


class TestIsOtpVerified:
    def test_unknown_uid_is_false(self, fake_db):
        assert is_otp_verified("nobody") is False

    def test_expired_stamp_is_false(self, fake_db):
        fake_db.seed(
            USER_DOC,
            {"otp_verified_until": (utc_now() - timedelta(days=1)).isoformat()},
        )
        assert is_otp_verified(UID) is False

    def test_future_stamp_is_true(self, fake_db):
        fake_db.seed(
            USER_DOC,
            {"otp_verified_until": (utc_now() + timedelta(days=10)).isoformat()},
        )
        assert is_otp_verified(UID) is True
