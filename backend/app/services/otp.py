"""OTP (one-time password) service for compulsory login verification.

Design:
  - 6-digit code, SHA-256 hashed at rest, 10-minute expiry, 5 verify attempts.
  - Challenges live at otp_challenges/{uid} — a top-level collection with no
    firestore.rules match, so clients can never read codes.
  - Delivery is pluggable, configured in Firestore (never env files):
      app_config/smtp  → {host, port, username, password, from}   (email)
      app_config/sms   → {provider: "msg91", authkey, sender, template_id}
    If neither is configured and APP_ENV != production, the code is logged
    server-side so development isn't blocked.
  - Enforcement kill-switch: app_config/auth {otp_required: bool} — default
    OFF so existing sessions keep working until the user flips it.
  - Successful verification stamps users/{uid}.otp_verified_until (30 days),
    cached in-process for 5 minutes to avoid a Firestore read per request.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status

from app.config import get_settings
from app.models.common import utc_now
from app.services.app_config import get_config_doc
from app.services.firestore import get_db

logger = logging.getLogger(__name__)

OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_MAX_SENDS_PER_HOUR = 5
OTP_SESSION_DAYS = 30

# uid -> (checked_at_monotonic, verified_until_iso | None)
_session_cache: dict[str, tuple[float, Optional[str]]] = {}
_SESSION_CACHE_TTL = 300.0


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _challenge_ref(db, uid: str):
    return db.collection("otp_challenges").document(uid)


def otp_required() -> bool:
    return bool(get_config_doc("auth").get("otp_required", False))


def request_otp(uid: str, email: Optional[str], phone: Optional[str]) -> dict:
    """Generate + deliver a code. Returns {sent_to, channel}."""
    db = get_db()
    ref = _challenge_ref(db, uid)
    now = utc_now()

    snap = ref.get()
    data = snap.to_dict() if snap.exists else {}
    window_start = data.get("window_start")
    sends = data.get("window_sends", 0)
    if isinstance(window_start, str):
        try:
            ws = datetime.fromisoformat(window_start)
            if now - ws < timedelta(hours=1) and sends >= OTP_MAX_SENDS_PER_HOUR:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="otp_rate_limited",
                )
            if now - ws >= timedelta(hours=1):
                sends = 0
                window_start = now.isoformat()
        except ValueError:
            sends = 0
            window_start = now.isoformat()
    else:
        window_start = now.isoformat()

    code = f"{secrets.randbelow(1_000_000):06d}"
    sent_to, channel = _deliver(code, email=email, phone=phone)

    ref.set(
        {
            "code_hash": _hash(code),
            "expires_at": (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
            "attempts": 0,
            "sent_to": sent_to,
            "channel": channel,
            "window_start": window_start,
            "window_sends": sends + 1,
            "created_at": now.isoformat(),
        }
    )
    logger.info("otp_sent uid=%s channel=%s", uid, channel)
    return {"sent_to": _mask(sent_to), "channel": channel, "ttl_minutes": OTP_TTL_MINUTES}


def verify_otp(uid: str, code: str) -> None:
    """Raises on failure; on success stamps the user's OTP session."""
    db = get_db()
    ref = _challenge_ref(db, uid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_not_requested")
    data = snap.to_dict() or {}

    attempts = int(data.get("attempts") or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="otp_locked")

    expires_at = data.get("expires_at")
    now = utc_now()
    try:
        expired = not expires_at or datetime.fromisoformat(expires_at) < now
    except ValueError:
        expired = True
    if expired:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_expired")

    if not secrets.compare_digest(_hash(code.strip()), str(data.get("code_hash") or "")):
        ref.update({"attempts": attempts + 1})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_incorrect")

    verified_until = (now + timedelta(days=OTP_SESSION_DAYS)).isoformat()
    # set(merge=True), not update(): a signed-in-but-unprovisioned user has no
    # users/{uid} doc yet, and OTP deliberately works pre-provisioning.
    db.collection("users").document(uid).set(
        {"otp_verified_until": verified_until}, merge=True
    )
    ref.delete()
    _session_cache[uid] = (time.monotonic(), verified_until)
    logger.info("otp_verified uid=%s", uid)


def is_otp_verified(uid: str) -> bool:
    """Cheap check used by request deps when enforcement is on.

    Only POSITIVE results are cached: on multi-instance Cloud Run, caching
    "not verified" would keep 403ing a user for the TTL on instances that
    didn't see their verification. Unverified users cost one Firestore read
    per request, which resolves as soon as they verify.
    """
    cached = _session_cache.get(uid)
    if cached and time.monotonic() - cached[0] < _SESSION_CACHE_TTL:
        verified_until = cached[1]
    else:
        snap = get_db().collection("users").document(uid).get()
        verified_until = (snap.to_dict() or {}).get("otp_verified_until") if snap.exists else None
        if verified_until:
            _session_cache[uid] = (time.monotonic(), verified_until)
    if not verified_until:
        return False
    try:
        return datetime.fromisoformat(verified_until) > utc_now()
    except ValueError:
        return False


# ─── Phone-number login (unauthenticated OTP → Firebase custom token) ──


def normalize_phone(phone: str) -> str:
    """Normalize to +91XXXXXXXXXX. INDIAN MOBILE NUMBERS ONLY (product rule):
    10 digits starting 6-9, with or without +91/0 prefix. Raises 400 otherwise."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_indian_mobile"
        )
    return f"+91{digits}"


def request_phone_login_otp(phone: str) -> dict:
    """Send a login code to an Indian mobile number (no auth required — this
    IS login). Rate-limited per phone; challenge keyed separately from uid
    challenges."""
    normalized = normalize_phone(phone)
    db = get_db()
    ref = db.collection("otp_challenges").document(f"phone_{normalized}")
    now = utc_now()

    # Test numbers (app_config/auth.test_phones: {"+91XXXXXXXXXX": "123456"}):
    # fixed code, no SMS sent, no rate-limit noise. Config-driven — remove the
    # map entry to disable. Never use for real accounts.
    test_phones = get_config_doc("auth").get("test_phones") or {}
    if isinstance(test_phones, dict) and normalized in test_phones:
        code = str(test_phones[normalized])
        ref.set(
            {
                "code_hash": _hash(code),
                "expires_at": (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
                "attempts": 0,
                "sent_to": normalized,
                "channel": "test",
                "window_start": now.isoformat(),
                "window_sends": 1,
                "created_at": now.isoformat(),
            }
        )
        logger.info("phone_login_otp_test_number")
        return {"sent_to": _mask(normalized), "channel": "test", "ttl_minutes": OTP_TTL_MINUTES}

    snap = ref.get()
    data = snap.to_dict() if snap.exists else {}
    window_start = data.get("window_start")
    sends = data.get("window_sends", 0)
    if isinstance(window_start, str):
        try:
            ws = datetime.fromisoformat(window_start)
            if now - ws < timedelta(hours=1) and sends >= OTP_MAX_SENDS_PER_HOUR:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="otp_rate_limited"
                )
            if now - ws >= timedelta(hours=1):
                sends = 0
                window_start = now.isoformat()
        except ValueError:
            sends = 0
            window_start = now.isoformat()
    else:
        window_start = now.isoformat()

    code = f"{secrets.randbelow(1_000_000):06d}"
    sent_to, channel = _deliver(code, email=None, phone=normalized)
    ref.set(
        {
            "code_hash": _hash(code),
            "expires_at": (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
            "attempts": 0,
            "sent_to": sent_to,
            "channel": channel,
            "window_start": window_start,
            "window_sends": sends + 1,
            "created_at": now.isoformat(),
        }
    )
    logger.info("phone_login_otp_sent channel=%s", channel)
    return {"sent_to": _mask(normalized), "channel": channel, "ttl_minutes": OTP_TTL_MINUTES}


def verify_phone_login_otp(phone: str, code: str) -> str:
    """Verify the code and return a Firebase custom token for that phone's
    user (created on first login). The client signs in with the token."""
    normalized = normalize_phone(phone)
    db = get_db()
    ref = db.collection("otp_challenges").document(f"phone_{normalized}")
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_not_requested")
    data = snap.to_dict() or {}

    attempts = int(data.get("attempts") or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="otp_locked")

    expires_at = data.get("expires_at")
    now = utc_now()
    try:
        expired = not expires_at or datetime.fromisoformat(expires_at) < now
    except ValueError:
        expired = True
    if expired:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_expired")

    if not secrets.compare_digest(_hash(code.strip()), str(data.get("code_hash") or "")):
        ref.update({"attempts": attempts + 1})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_incorrect")

    ref.delete()

    from firebase_admin import auth as fb_auth

    try:
        fb_user = fb_auth.get_user_by_phone_number(normalized)
    except fb_auth.UserNotFoundError:
        fb_user = fb_auth.create_user(phone_number=normalized)
    # Phone possession IS the verification — stamp the OTP session too so the
    # second-factor gate doesn't immediately re-challenge.
    db.collection("users").document(fb_user.uid).set(
        {
            "otp_verified_until": (now + timedelta(days=OTP_SESSION_DAYS)).isoformat(),
            "phone": normalized,
        },
        merge=True,
    )
    _session_cache[fb_user.uid] = (
        time.monotonic(),
        (now + timedelta(days=OTP_SESSION_DAYS)).isoformat(),
    )
    token = fb_auth.create_custom_token(fb_user.uid)
    logger.info("phone_login_verified uid=%s", fb_user.uid)
    return token.decode() if isinstance(token, bytes) else token


# ─── Delivery ──────────────────────────────────────────────────────


def _deliver(code: str, *, email: Optional[str], phone: Optional[str]) -> tuple[str, str]:
    sms_cfg = get_config_doc("sms")
    smtp_cfg = get_config_doc("smtp")

    if phone and sms_cfg.get("authkey"):
        _send_sms_msg91(sms_cfg, phone, code)
        return phone, "sms"
    if email and smtp_cfg.get("host"):
        _send_email(smtp_cfg, email, code)
        return email, "email"

    # Dev escape hatch: log the code instead of sending. Active outside
    # production, or in production ONLY via the explicit app_config/auth
    # {otp_dev_log: true} switch (for pre-SMS-provider testing — turn it
    # off before real users onboard).
    if get_settings().app_env != "production" or get_config_doc("auth").get("otp_dev_log"):
        logger.warning("otp_dev_mode code=%s (configure app_config/smtp or /sms)", code)
        return email or phone or "dev", "dev_log"

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="otp_delivery_not_configured"
    )


def _send_email(cfg: dict, to: str, code: str) -> None:
    import smtplib
    from email.mime.text import MIMEText

    msg = MIMEText(
        f"Your SoapNotesAi verification code is {code}. "
        f"It expires in {OTP_TTL_MINUTES} minutes. Never share this code."
    )
    msg["Subject"] = f"{code} is your SoapNotesAi code"
    msg["From"] = cfg.get("from") or cfg.get("username") or ""
    msg["To"] = to
    try:
        with smtplib.SMTP(str(cfg["host"]), int(cfg.get("port") or 587), timeout=15) as s:
            s.starttls()
            if cfg.get("username"):
                s.login(str(cfg["username"]), str(cfg.get("password") or ""))
            s.send_message(msg)
    except Exception as e:
        logger.exception("otp_email_send_failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="otp_send_failed"
        ) from e


def _send_sms_msg91(cfg: dict, phone: str, code: str) -> None:
    import requests

    try:
        resp = requests.post(
            "https://control.msg91.com/api/v5/otp",
            params={
                "template_id": cfg.get("template_id") or "",
                "mobile": phone.lstrip("+"),
                "otp": code,
            },
            headers={"authkey": str(cfg["authkey"])},
            timeout=15,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"msg91 status {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.exception("otp_sms_send_failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="otp_send_failed"
        ) from e


def _mask(dest: str) -> str:
    if "@" in dest:
        local, _, domain = dest.partition("@")
        return f"{local[:2]}***@{domain}"
    return f"***{dest[-4:]}" if len(dest) >= 4 else "***"
