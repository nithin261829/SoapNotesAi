"""Account provisioning: sign-up (create org or join via invite), clinic
switch, and the /me endpoint.

After provisioning, the user's Firebase custom claims carry the tenancy
context (org_id, active_clinic_id, role) that Firestore + Storage rules
enforce against. Mobile must call `user.getIdToken(true)` after these
endpoints succeed so the fresh claims land locally.
"""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import auth as fb_auth
from google.cloud import firestore as gcf
from pydantic import BaseModel, Field

from app.auth.deps import CurrentUserDep, TenantUserDep, UserContext
from app.models.clinic import Clinic, ClinicLetterhead
from app.models.common import utc_now
from app.models.organization import Organization
from app.models.user_profile import ClinicMembership, ClinicRole, UserProfile
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])

_MAX_INVITE_AGE = timedelta(days=14)


# ─── Request / response bodies ────────────────────────────────────


class CreateOrgRequest(BaseModel):
    org_name: str = Field(min_length=1, max_length=120)
    clinic_name: str = Field(min_length=1, max_length=120)
    display_name: Optional[str] = Field(None, max_length=120)
    credentials: Optional[str] = Field(None, max_length=40)


class JoinInviteRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=120)
    credentials: Optional[str] = Field(None, max_length=40)


class ClinicSwitchRequest(BaseModel):
    clinic_id: str = Field(min_length=1)


class PushTokenRequest(BaseModel):
    token: str = Field(min_length=8, max_length=4096)
    # "expo" (Expo push service, relays via FCM/APNs) or "fcm" (raw FCM token).
    token_type: Literal["expo", "fcm"] = "expo"


class MeResponse(BaseModel):
    profile: UserProfile
    org_name: Optional[str] = None
    active_clinic_name: Optional[str] = None


# ─── Helpers ───────────────────────────────────────────────────────



_HONORIFIC_RE = re.compile(r"^\s*(dr|doctor|prof|professor|mr|mrs|ms)\.?\s+", re.IGNORECASE)


def _clean_display_name(name):
    """Strip a leading honorific — the UI renders 'Dr. {name}', so a stored
    'Dr. Nithin' would double up to 'Dr. Dr. Nithin'."""
    if not name:
        return name
    cleaned = _HONORIFIC_RE.sub("", name).strip()
    return cleaned or name


def _slugify(s: str, fallback: str = "x") -> str:
    """Stable URL-safe slug. Adds a short random suffix to avoid collisions."""
    base = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or fallback
    suffix = secrets.token_hex(3)
    return f"{base}-{suffix}"


def _set_tenancy_claims(uid: str, *, org_id: str, active_clinic_id: str, role: str) -> None:
    fb_auth.set_custom_user_claims(
        uid,
        {"org_id": org_id, "active_clinic_id": active_clinic_id, "role": role},
    )


def _next_registration_id(db: gcf.Client) -> str:
    """Permanent unique doctor id, e.g. "SNA-00042". Transactional counter at
    app_config/counters so ids are never duplicated or reused."""
    counter_ref = db.collection("app_config").document("counters")
    transaction = db.transaction()

    @gcf.transactional
    def _txn(txn) -> int:
        snap = counter_ref.get(transaction=txn)
        current = int((snap.to_dict() or {}).get("registration_seq") or 0) if snap.exists else 0
        txn.set(counter_ref, {"registration_seq": current + 1}, merge=True)
        return current + 1

    return f"SNA-{_txn(transaction):05d}"


def _require_unprovisioned(user: UserContext, db: gcf.Client) -> None:
    """Reject only if the user is already in an org.

    Phone-OTP login (and OTP verification) create a partial users/{uid} doc
    holding just `phone` / `otp_verified_until` BEFORE org setup — so mere
    existence of the doc does NOT mean provisioned. Only an `org_id` on the
    doc (or in the token claims) counts.
    """
    if user.org_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_provisioned",
        )
    existing = db.collection("users").document(user.uid).get()
    if existing.exists and (existing.to_dict() or {}).get("org_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_provisioned",
        )


# ─── Endpoints ─────────────────────────────────────────────────────


@router.get("/me", response_model=MeResponse)
def me(user: CurrentUserDep) -> MeResponse:
    """Returns the caller's profile + the human-readable org / active clinic
    names. 404 if the user hasn't been provisioned yet — the mobile uses
    that as the signal to show the create-org / join-with-invite screen."""
    db = get_db()
    snap = db.collection("users").document(user.uid).get()
    data = snap.to_dict() if snap.exists else None
    # Not provisioned = no doc, OR only the partial doc that phone-OTP / OTP
    # verification writes (phone + otp session, but no org_id yet). Either way
    # the app shows the setup screen. Never 500 on a partial doc.
    if not data or not data.get("org_id"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="user_not_provisioned",
        )
    profile = UserProfile.model_validate(data)

    org_name: Optional[str] = None
    org_snap = db.collection("organizations").document(profile.org_id).get()
    if org_snap.exists:
        org_data = org_snap.to_dict() or {}
        org_name = org_data.get("name")

    active_clinic_name: Optional[str] = None
    active_clinic_id = user.active_clinic_id or profile.default_clinic_id
    if active_clinic_id:
        clinic_snap = (
            db.collection("organizations")
            .document(profile.org_id)
            .collection("clinics")
            .document(active_clinic_id)
            .get()
        )
        if clinic_snap.exists:
            clinic_data = clinic_snap.to_dict() or {}
            active_clinic_name = clinic_data.get("name")

    return MeResponse(profile=profile, org_name=org_name, active_clinic_name=active_clinic_name)


@router.post(
    "/signup/org",
    status_code=status.HTTP_201_CREATED,
    response_model=UserProfile,
    summary="Create a brand-new organization with the caller as owner",
)
def signup_org(body: CreateOrgRequest, user: CurrentUserDep) -> UserProfile:
    db = get_db()
    _require_unprovisioned(user, db)

    if not user.email and not user.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="identity_required_on_token",
        )

    org_id = _slugify(body.org_name, fallback="org")
    clinic_id = _slugify(body.clinic_name, fallback="clinic")

    now = utc_now()
    org = Organization(
        name=body.org_name,
        owner_uid=user.uid,
        created_at=now,
        updated_at=now,
    )
    clinic = Clinic(
        org_id=org_id,
        name=body.clinic_name,
        letterhead=ClinicLetterhead(name=body.clinic_name),
        created_at=now,
        updated_at=now,
    )
    profile = UserProfile(
        email=user.email,
        phone=user.phone,
        display_name=_clean_display_name(body.display_name),
        credentials=body.credentials,
        registration_id=_next_registration_id(db),
        org_id=org_id,
        default_clinic_id=clinic_id,
        memberships=[ClinicMembership(clinic_id=clinic_id, role="owner", joined_at=now)],
        created_at=now,
        updated_at=now,
    )

    # Single batched write so we either succeed entirely or write nothing.
    batch = db.batch()
    batch.set(
        db.collection("organizations").document(org_id),
        org.model_dump(mode="json"),
    )
    batch.set(
        db.collection("organizations").document(org_id).collection("clinics").document(clinic_id),
        clinic.model_dump(mode="json"),
    )
    batch.set(
        db.collection("users").document(user.uid),
        profile.model_dump(mode="json"),
    )
    batch.commit()

    _set_tenancy_claims(user.uid, org_id=org_id, active_clinic_id=clinic_id, role="owner")

    logger.info("signup_org uid=%s org=%s clinic=%s", user.uid, org_id, clinic_id)
    return profile


@router.post(
    "/signup/invite/{code}",
    status_code=status.HTTP_201_CREATED,
    response_model=UserProfile,
    summary="Join an existing organization using a single-use invite code",
)
def signup_invite(code: str, body: JoinInviteRequest, user: CurrentUserDep) -> UserProfile:
    db = get_db()
    _require_unprovisioned(user, db)

    if not user.email and not user.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="identity_required_on_token",
        )

    invite_ref = db.collection("invites").document(code)
    invite_snap = invite_ref.get()
    if not invite_snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invite_not_found")
    invite = invite_snap.to_dict() or {}

    if invite.get("used_at"):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="invite_already_used")

    expires_at = invite.get("expires_at")
    if isinstance(expires_at, datetime):
        # Firestore returns timezone-aware datetimes.
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="invite_expired")

    org_id = invite.get("org_id")
    clinic_id = invite.get("clinic_id")
    role = invite.get("role", "doctor")
    if not isinstance(org_id, str) or not isinstance(clinic_id, str):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="invite_corrupt",
        )
    if role not in ("owner", "admin", "doctor", "viewer"):
        role = "doctor"

    now = utc_now()
    profile = UserProfile(
        email=user.email,
        phone=user.phone,
        display_name=_clean_display_name(body.display_name),
        credentials=body.credentials,
        registration_id=_next_registration_id(db),
        org_id=org_id,
        default_clinic_id=clinic_id,
        memberships=[ClinicMembership(clinic_id=clinic_id, role=role, joined_at=now)],
        created_at=now,
        updated_at=now,
    )

    batch = db.batch()
    batch.set(db.collection("users").document(user.uid), profile.model_dump(mode="json"))
    batch.update(invite_ref, {"used_at": now, "used_by_uid": user.uid})
    batch.commit()

    _set_tenancy_claims(user.uid, org_id=org_id, active_clinic_id=clinic_id, role=role)

    logger.info("signup_invite uid=%s org=%s clinic=%s role=%s", user.uid, org_id, clinic_id, role)
    return profile


class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=120)
    credentials: Optional[str] = Field(None, max_length=40)
    phone: Optional[str] = Field(None, max_length=20)


@router.patch("/me", response_model=MeResponse)
def update_me(body: UpdateProfileRequest, user: TenantUserDep) -> MeResponse:
    """A doctor edits their own profile (name, credentials, phone)."""
    db = get_db()
    ref = db.collection("users").document(user.uid)
    snap = ref.get()
    if not snap.exists or not (snap.to_dict() or {}).get("org_id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_provisioned")

    patch: dict[str, object] = {"updated_at": utc_now()}
    if body.display_name is not None:
        patch["display_name"] = _clean_display_name(body.display_name.strip()) or None
    if body.credentials is not None:
        patch["credentials"] = body.credentials.strip() or None
    if body.phone is not None:
        patch["phone"] = body.phone.strip() or None
    ref.update(patch)

    logger.info("profile_updated uid=%s", user.uid)
    return me(user)


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def register_push_token(body: PushTokenRequest, user: TenantUserDep) -> None:
    """Store the device push token for follow-up reminders."""
    db = get_db()
    db.collection("users").document(user.uid).update(
        {
            "push_token": body.token,
            "push_token_type": body.token_type,
            "updated_at": utc_now(),
        }
    )
    logger.info("push_token_registered uid=%s type=%s", user.uid, body.token_type)


@router.post(
    "/clinic-switch",
    response_model=MeResponse,
    summary="Switch the active clinic for a multi-clinic user",
)
def clinic_switch(body: ClinicSwitchRequest, user: TenantUserDep) -> MeResponse:
    db = get_db()
    profile_ref = db.collection("users").document(user.uid)
    snap = profile_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_provisioned")
    profile = UserProfile.model_validate(snap.to_dict())

    membership = next((m for m in profile.memberships if m.clinic_id == body.clinic_id), None)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_a_member")

    profile_ref.update({"default_clinic_id": body.clinic_id, "updated_at": utc_now()})
    _set_tenancy_claims(
        user.uid,
        org_id=profile.org_id,
        active_clinic_id=body.clinic_id,
        role=membership.role,
    )

    # Build the response off the now-updated profile.
    profile_dict = profile.model_dump()
    profile_dict["default_clinic_id"] = body.clinic_id
    fresh_profile = UserProfile.model_validate(profile_dict)

    clinic_snap = (
        db.collection("organizations")
        .document(profile.org_id)
        .collection("clinics")
        .document(body.clinic_id)
        .get()
    )
    clinic_name: Optional[str] = None
    if clinic_snap.exists:
        clinic_data = clinic_snap.to_dict() or {}
        clinic_name = clinic_data.get("name")

    org_snap = db.collection("organizations").document(profile.org_id).get()
    org_name = None
    if org_snap.exists:
        org_data = org_snap.to_dict() or {}
        org_name = org_data.get("name")

    return MeResponse(profile=fresh_profile, org_name=org_name, active_clinic_name=clinic_name)
