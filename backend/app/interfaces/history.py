"""Patient-history retrieval (RAG) for follow-up visits.

A patient's earlier SOAP notes (one chunk per section) and uploaded documents
(scanned reports, past records; text read by the model) are embedded and stored
under that patient's own Firestore path, so a search can only ever return that
patient's history. On a follow-up, the closest earlier visits (in full) and
report parts are compared with the new note, and every comparison statement
must cite the chunks it rests on.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

SourceKind = Literal["note", "document"]


@dataclass(frozen=True)
class PatientKey:
    org_id: str
    clinic_id: str
    patient_id: str


@dataclass(frozen=True)
class HistoryChunk:
    source: SourceKind
    source_id: str      # recording ID or document ID
    part: str           # SOAP section ("assessment") or document part ("p2")
    date: str           # encounter date or upload date, ISO
    label: str          # shown to the doctor: "Assessment", "Blood report Mar 2026"
    text: str

    @property
    def id(self) -> str:
        return f"{self.source}-{self.source_id}-{self.part}"


class Embedder(Protocol):
    def embed(self, texts: list[str], *, task: Literal["document", "query"]) -> list[list[float]]:
        """One vector per text; `task` picks the retrieval-document or query embedding."""
        ...


class HistoryStore(Protocol):
    def add(self, patient: PatientKey, chunks: list[HistoryChunk],
            vectors: list[list[float]]) -> None: ...

    def search(self, patient: PatientKey, vector: list[float], *, limit: int,
               source: SourceKind | None = None,
               exclude_source_id: str | None = None) -> list[HistoryChunk]:
        """Nearest chunks of this patient only, closest first; `source` limits the kind."""
        ...

    def get(self, patient: PatientKey, source_ids: list[str]) -> list[HistoryChunk]:
        """Every chunk of the given notes or documents (at most 30 IDs)."""
        ...

    def remove(self, patient: PatientKey, source_id: str) -> None:
        """Drop every chunk of one note or document (e.g. after the document is deleted)."""
        ...


class HistoryComparer(Protocol):
    def compare(self, *, new_note: str, sources: list[HistoryChunk]) -> list[tuple[str, list[str]]]:
        """Statements comparing today's note with the sources, each with the chunk IDs it cites."""
        ...


class DocumentReader(Protocol):
    def read(self, *, file_bytes: bytes, mime_type: str) -> str:
        """Plain text of an uploaded document (PDF or image), in reading order."""
        ...
