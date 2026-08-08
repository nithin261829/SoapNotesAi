"""Firebase Admin SDK bootstrap + ID-token verification helpers.

Firebase init is tolerant of missing creds so the backend can run in local mode
without any Google setup. Endpoints that require auth (added in step 11) will
fail their auth dep with a clear 503 if init was skipped.
"""
from __future__ import annotations

import logging
import os

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials

from app.config import Settings

logger = logging.getLogger(__name__)

_INITIALIZED = False


def is_initialized() -> bool:
    return _INITIALIZED


def init_firebase(settings: Settings) -> None:
    """Initialize the Firebase Admin SDK once at process startup.

    Two init paths:
      1. Local dev — GOOGLE_APPLICATION_CREDENTIALS points at a JSON key file.
      2. Cloud Run / GKE / any GCP runtime — no file; the SDK picks up the
         attached service account via Application Default Credentials.
    """
    global _INITIALIZED
    if _INITIALIZED:
        return

    init_kwargs: dict[str, str] = {}
    if settings.firebase_project_id:
        init_kwargs["projectId"] = settings.firebase_project_id
    if settings.firebase_storage_bucket:
        init_kwargs["storageBucket"] = settings.firebase_storage_bucket

    creds_path = settings.google_application_credentials
    if creds_path and os.path.exists(creds_path):
        # Local dev: explicit service-account JSON.
        cred = credentials.Certificate(creds_path)
        firebase_admin.initialize_app(cred, init_kwargs)
        _INITIALIZED = True
        logger.info(
            "Firebase Admin SDK initialized via JSON key (project=%s)",
            settings.firebase_project_id or "<inferred>",
        )
        return

    # Cloud Run / GKE: ADC. firebase_admin.initialize_app() with no `cred` arg
    # uses google.auth.default() under the hood, which finds the attached
    # service account on Cloud Run automatically.
    try:
        firebase_admin.initialize_app(options=init_kwargs)
        _INITIALIZED = True
        logger.info(
            "Firebase Admin SDK initialized via ADC (project=%s)",
            settings.firebase_project_id or "<inferred>",
        )
    except Exception:
        logger.exception(
            "Firebase Admin SDK NOT initialized — no JSON key and ADC failed. "
            "Auth-protected endpoints will return 503."
        )


def verify_id_token(id_token: str) -> dict[str, object]:
    """Verify a Firebase ID token. Raises if invalid / expired / revoked."""
    if not _INITIALIZED:
        raise RuntimeError("firebase_not_initialized")
    return fb_auth.verify_id_token(id_token, check_revoked=True)
