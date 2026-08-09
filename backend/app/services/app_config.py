"""Runtime configuration stored in Firestore, per user preference — no secrets
in env files.

Docs live at app_config/{name}. That top-level collection has no match in
firestore.rules, so clients are denied; only the backend (Admin SDK) reads it.
Values are cached in-process for a short TTL so key rotation applies without a
restart but we don't hit Firestore on every request.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from app.config import get_settings
from app.services.firestore import get_db

_TTL_SECONDS = 300
_cache: dict[str, tuple[float, dict]] = {}


def get_config_doc(name: str) -> dict:
    now = time.monotonic()
    hit = _cache.get(name)
    if hit and now - hit[0] < _TTL_SECONDS:
        return hit[1]
    snap = get_db().collection("app_config").document(name).get()
    data = snap.to_dict() if snap.exists else {}
    if not isinstance(data, dict):
        data = {}
    _cache[name] = (now, data)
    return data


def invalidate_config_cache() -> None:
    _cache.clear()


@dataclass(frozen=True)
class RazorpayConfig:
    key_id: str
    key_secret: str
    webhook_secret: str

    @property
    def configured(self) -> bool:
        return bool(self.key_id and self.key_secret)


def get_razorpay_config() -> RazorpayConfig:
    """Firestore app_config/razorpay first; env vars as fallback."""
    doc = get_config_doc("razorpay")
    settings = get_settings()
    return RazorpayConfig(
        key_id=str(doc.get("key_id") or settings.razorpay_key_id or ""),
        key_secret=str(doc.get("key_secret") or settings.razorpay_key_secret or ""),
        webhook_secret=str(doc.get("webhook_secret") or settings.razorpay_webhook_secret or ""),
    )
