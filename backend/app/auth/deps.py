"""FastAPI dependencies that turn a bearer token into a verified caller identity.

`org_id` + `active_clinic_id` come from custom claims set by the backend at
sign-up / clinic-switch time. Never trust client-supplied uid / org / clinic —
read them from the verified token only.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, status

from app.auth.firebase import is_initialized, verify_id_token

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class UserContext:
    """What we know about the caller after verifying their ID token.

    `org_id` / `active_clinic_id` / `role` are None until the backend has
    provisioned the user. Endpoints that touch tenant data should depend on
    `tenant_user` (which 403s on None) instead of `current_user`.
    """
    uid: str
    email: Optional[str]
    org_id: Optional[str]
    active_clinic_id: Optional[str]
    role: Optional[str]


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_bearer_token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return authorization.split(" ", 1)[1].strip()


def current_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> UserContext:
    """Verify the Firebase ID token. Raises 401 / 503 on failure."""
    if not is_initialized():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="firebase_not_configured",
        )
    token = _extract_bearer(authorization)
    try:
        claims = verify_id_token(token)
    except Exception as e:  # firebase_admin raises a hierarchy of auth errors
        logger.info("id_token_verification_failed: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    uid = claims.get("uid") or claims.get("user_id")
    if not isinstance(uid, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        )

    role = claims.get("role")
    if role not in ("owner", "admin", "doctor", "viewer"):
        role = None

    email = claims.get("email")
    return UserContext(
        uid=uid,
        email=email if isinstance(email, str) else None,
        org_id=_str_or_none(claims.get("org_id")),
        active_clinic_id=_str_or_none(claims.get("active_clinic_id")),
        role=role,
    )


def tenant_user(
    user: Annotated[UserContext, Depends(current_user)],
) -> UserContext:
    """For endpoints that touch tenant data. 403s if the user hasn't been
    provisioned into an org + active clinic yet, or (when the OTP kill-switch
    in app_config/auth is on) hasn't completed OTP verification."""
    if not user.org_id or not user.active_clinic_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="user_not_provisioned",
        )
    # Imported here to avoid a circular import at module load.
    from app.services.otp import is_otp_verified, otp_required

    if otp_required() and not is_otp_verified(user.uid):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="otp_verification_required",
        )
    return user


def require_owner(
    user: Annotated[UserContext, Depends(tenant_user)],
) -> UserContext:
    if user.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="owner_required",
        )
    return user


def require_clinician(
    user: Annotated[UserContext, Depends(tenant_user)],
) -> UserContext:
    """Owner/admin/doctor only. Staff ("viewer") accounts are restricted to
    reading patients/recordings, printing PDFs, and follow-up logging — they
    cannot create or edit clinical notes or patient records."""
    if user.role not in ("owner", "admin", "doctor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="clinician_role_required",
        )
    return user


def _str_or_none(v: object) -> Optional[str]:
    return v if isinstance(v, str) and v else None


CurrentUserDep = Annotated[UserContext, Depends(current_user)]
TenantUserDep = Annotated[UserContext, Depends(tenant_user)]
OwnerDep = Annotated[UserContext, Depends(require_owner)]
ClinicianDep = Annotated[UserContext, Depends(require_clinician)]
