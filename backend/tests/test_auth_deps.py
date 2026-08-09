"""Role gates and OTP enforcement in app.auth.deps."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.auth.deps import require_clinician, require_owner, tenant_user
from tests.conftest import make_user


class TestRequireClinician:
    @pytest.mark.parametrize("role", ["owner", "admin", "doctor"])
    def test_clinician_roles_pass(self, role):
        user = make_user(role=role)
        assert require_clinician(user) is user

    def test_viewer_is_403(self):
        with pytest.raises(HTTPException) as ei:
            require_clinician(make_user(role="viewer"))
        assert ei.value.status_code == 403
        assert ei.value.detail == "clinician_role_required"

    def test_missing_role_is_403(self):
        with pytest.raises(HTTPException) as ei:
            require_clinician(make_user(role=None))
        assert ei.value.status_code == 403


class TestRequireOwner:
    def test_owner_passes(self):
        user = make_user(role="owner")
        assert require_owner(user) is user

    @pytest.mark.parametrize("role", ["doctor", "admin", "viewer", None])
    def test_non_owner_is_403(self, role):
        with pytest.raises(HTTPException) as ei:
            require_owner(make_user(role=role))
        assert ei.value.status_code == 403
        assert ei.value.detail == "owner_required"


class TestTenantUser:
    def test_unprovisioned_user_is_403(self):
        with pytest.raises(HTTPException) as ei:
            tenant_user(make_user(org_id=None, clinic_id=None))
        assert ei.value.status_code == 403
        assert ei.value.detail == "user_not_provisioned"

    def test_missing_clinic_is_403(self):
        with pytest.raises(HTTPException) as ei:
            tenant_user(make_user(clinic_id=None))
        assert ei.value.status_code == 403
        assert ei.value.detail == "user_not_provisioned"

    def test_otp_required_and_unverified_is_403(self, monkeypatch):
        monkeypatch.setattr("app.services.otp.otp_required", lambda: True)
        monkeypatch.setattr("app.services.otp.is_otp_verified", lambda uid: False)
        with pytest.raises(HTTPException) as ei:
            tenant_user(make_user(role="doctor"))
        assert ei.value.status_code == 403
        assert ei.value.detail == "otp_verification_required"

    def test_otp_required_and_verified_passes(self, monkeypatch):
        monkeypatch.setattr("app.services.otp.otp_required", lambda: True)
        monkeypatch.setattr("app.services.otp.is_otp_verified", lambda uid: True)
        user = make_user(role="doctor")
        assert tenant_user(user) is user

    def test_otp_not_required_skips_verification(self, monkeypatch):
        monkeypatch.setattr("app.services.otp.otp_required", lambda: False)
        monkeypatch.setattr(
            "app.services.otp.is_otp_verified",
            lambda uid: pytest.fail("is_otp_verified must not be called"),
        )
        user = make_user(role="viewer")  # any provisioned role passes tenant_user
        assert tenant_user(user) is user
