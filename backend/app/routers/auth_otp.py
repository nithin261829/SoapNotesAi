"""OTP verification endpoints.

These use CurrentUserDep (not tenant) so a signed-in-but-unverified user can
complete the OTP step. Enforcement itself happens in auth/deps.tenant_user
when app_config/auth.otp_required is true.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.auth.deps import CurrentUserDep
from app.services.firestore import get_db
from app.services.otp import (
    is_otp_verified,
    otp_required,
    request_otp,
    request_phone_login_otp,
    verify_otp,
    verify_phone_login_otp,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/otp", tags=["auth"])


class OtpStatusResponse(BaseModel):
    required: bool
    verified: bool


class OtpRequestResponse(BaseModel):
    sent_to: str
    channel: str
    ttl_minutes: int


class OtpVerifyRequest(BaseModel):
    code: str = Field(min_length=4, max_length=8)


@router.get("/status", response_model=OtpStatusResponse)
def otp_status(user: CurrentUserDep) -> OtpStatusResponse:
    required = otp_required()
    return OtpStatusResponse(
        required=required,
        verified=is_otp_verified(user.uid) if required else True,
    )


@router.post("/request", response_model=OtpRequestResponse)
def otp_request(user: CurrentUserDep) -> OtpRequestResponse:
    # Deliver to the registered phone if on file, else the account email.
    snap = get_db().collection("users").document(user.uid).get()
    profile = snap.to_dict() if snap.exists else {}
    phone = (profile or {}).get("phone")
    result = request_otp(user.uid, email=user.email, phone=phone)
    return OtpRequestResponse(**result)


@router.post("/verify", response_model=OtpStatusResponse)
def otp_verify(body: OtpVerifyRequest, user: CurrentUserDep) -> OtpStatusResponse:
    verify_otp(user.uid, body.code)
    return OtpStatusResponse(required=otp_required(), verified=True)


# ─── Phone-number login (primary sign-in method, no prior auth) ────


class PhoneLoginRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=20)


class PhoneLoginVerifyRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=20)
    code: str = Field(min_length=4, max_length=8)


class PhoneLoginVerifyResponse(BaseModel):
    # Firebase custom token; the client calls signInWithCustomToken with it.
    custom_token: str


@router.post("/phone/request", response_model=OtpRequestResponse)
def phone_login_request(body: PhoneLoginRequest) -> OtpRequestResponse:
    """Send a login code to a phone number. Unauthenticated by design — the
    code IS the login. Rate-limited per phone (5/hour), 10-min expiry."""
    result = request_phone_login_otp(body.phone)
    return OtpRequestResponse(**result)


@router.post("/phone/verify", response_model=PhoneLoginVerifyResponse)
def phone_login_verify(body: PhoneLoginVerifyRequest) -> PhoneLoginVerifyResponse:
    token = verify_phone_login_otp(body.phone, body.code)
    return PhoneLoginVerifyResponse(custom_token=token)
