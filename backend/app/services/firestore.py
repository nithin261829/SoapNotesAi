"""Thin wrapper around firebase_admin's Firestore client.

The client is created lazily on first use so import order doesn't matter and
tests can override via `app.dependency_overrides`.
"""
from __future__ import annotations

import logging
from typing import Optional

from google.cloud import firestore as gcf

logger = logging.getLogger(__name__)

_client: Optional[gcf.Client] = None


def get_db() -> gcf.Client:
    """Return a singleton Firestore client. Assumes Firebase Admin SDK was
    initialized by the lifespan handler (see app/main.py)."""
    global _client
    if _client is None:
        # firebase_admin initializes the underlying GCP client with the same
        # creds; google.cloud.firestore picks them up via Application Default.
        from firebase_admin import firestore as fa_firestore

        _client = fa_firestore.client()
        logger.info("Firestore client initialized")
    return _client
