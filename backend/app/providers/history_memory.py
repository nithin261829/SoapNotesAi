"""In-memory `HistoryStore` for tests and the offline eval (no Firestore)."""
from __future__ import annotations

import math

from app.interfaces.history import HistoryChunk, PatientKey


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class InMemoryHistoryStore:
    """Keyed by patient, like the Firestore path, so searches never cross patients."""

    def __init__(self) -> None:
        self._chunks: dict[PatientKey, dict[str, tuple[HistoryChunk, list[float]]]] = {}

    def add(self, patient: PatientKey, chunks: list[HistoryChunk],
            vectors: list[list[float]]) -> None:
        bucket = self._chunks.setdefault(patient, {})
        for chunk, vector in zip(chunks, vectors, strict=True):
            bucket[chunk.id] = (chunk, vector)

    def search(self, patient: PatientKey, vector: list[float], *, limit: int,
               exclude_source_id: str | None = None) -> list[HistoryChunk]:
        scored = [(_cosine(vector, v), c) for c, v in self._chunks.get(patient, {}).values()
                  if c.source_id != exclude_source_id]
        return [c for _, c in sorted(scored, key=lambda x: x[0], reverse=True)[:limit]]

    def remove(self, patient: PatientKey, source_id: str) -> None:
        bucket = self._chunks.get(patient, {})
        for chunk_id in [k for k, (c, _) in bucket.items() if c.source_id == source_id]:
            del bucket[chunk_id]
