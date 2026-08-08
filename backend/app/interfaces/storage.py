from __future__ import annotations

from typing import BinaryIO, Protocol


class StorageBackend(Protocol):
    """Object-storage interface. Default impl: Cloud Storage for Firebase."""

    def upload(self, *, path: str, data: BinaryIO, content_type: str) -> str:
        """Upload bytes at `path` and return the canonical storage URI (e.g. gs://...)."""
        ...

    def signed_url(self, *, path: str, expires_in_seconds: int = 900) -> str:
        """Return a time-limited download URL for `path`."""
        ...

    def delete(self, *, path: str) -> None: ...
