"""Render-time letterhead assembly: fetches the clinic logo from Cloud Storage
and inlines it as a base64 data URI so WeasyPrint embeds the pixels INTO the
PDF. No external links — the letterhead always displays, everywhere.

Logo bytes are cached in-process (10-min TTL, invalidated on letterhead
update) so PDF rendering doesn't hit Storage on every request.
"""
from __future__ import annotations

import base64
import logging
import time

logger = logging.getLogger(__name__)

_TTL = 600.0
# (org, clinic) -> (fetched_at, data_uri | None)
_logo_cache: dict[tuple[str, str], tuple[float, str | None]] = {}


def invalidate_logo_cache(org_id: str, clinic_id: str) -> None:
    _logo_cache.pop((org_id, clinic_id), None)


def logo_data_uri(org_id: str, clinic_id: str, gs_uri: str | None) -> str | None:
    """Base64 data URI for the clinic logo, or None when there is no logo."""
    if not gs_uri or not gs_uri.startswith("gs://"):
        return None
    key = (org_id, clinic_id)
    hit = _logo_cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _TTL:
        return hit[1]
    try:
        from firebase_admin import storage as fb_storage

        _, _, rest = gs_uri.partition("gs://")
        bucket_name, _, path = rest.partition("/")
        blob = fb_storage.bucket(bucket_name).blob(path)
        raw = blob.download_as_bytes()
        mime = "image/png" if path.endswith(".png") else "image/jpeg"
        uri = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    except Exception:
        logger.exception("letterhead_logo_fetch_failed org=%s clinic=%s", org_id, clinic_id)
        uri = None
    _logo_cache[key] = (now, uri)
    return uri


def letterhead_context(org_id: str, clinic_id: str, clinic_data: dict | None) -> dict:
    """Template context for the PDF header from a clinic Firestore doc."""
    letterhead = (clinic_data or {}).get("letterhead") or {}
    if not isinstance(letterhead, dict):
        letterhead = {}
    return {
        "name": letterhead.get("name") or "Clinic",
        "address_lines": letterhead.get("address_lines") or [],
        "phone": letterhead.get("phone"),
        "email": letterhead.get("email"),
        "tagline": letterhead.get("tagline"),
        "logo_data_uri": logo_data_uri(org_id, clinic_id, letterhead.get("logo_storage_path")),
    }
