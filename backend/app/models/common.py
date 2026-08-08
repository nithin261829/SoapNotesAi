from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FirestoreModel(BaseModel):
    """Base model with Firestore-friendly settings."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
        populate_by_name=True,
    )
