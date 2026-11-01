"""Patient-history RAG: index earlier notes and documents, compare follow-ups.

Indexing: each saved SOAP note becomes one chunk per non-empty section; each
uploaded document is read to text and split into ~1,200-character parts. Chunks
are embedded and stored under the patient (see `app.interfaces.history`).

Follow-ups: the new note's subjective + assessment is the query; the closest
chunks go to the comparer, and any statement that does not cite a retrieved
chunk is dropped, so the note never shows history it cannot point to.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from app.interfaces.history import (
    DocumentReader,
    Embedder,
    HistoryChunk,
    HistoryComparer,
    HistoryStore,
    PatientKey,
)
from app.models.soap import HistorySource, HistoryStatement, SoapNote

logger = logging.getLogger(__name__)

SECTIONS = ("subjective", "objective", "assessment", "plan")
DOCUMENT_PART_CHARS = 1200


def _lines(value: Any, prefix: str = "") -> list[str]:
    """Flatten a SOAP section into "field: value" lines, skipping empty fields."""
    if value in (None, "", [], {}):
        return []
    if isinstance(value, dict):
        return [line for k, v in value.items() for line in _lines(v, f"{prefix}{k}.")]
    if isinstance(value, list):
        items = [", ".join(f"{k}: {v}" for k, v in x.items() if v not in (None, ""))
                 if isinstance(x, dict) else str(x) for x in value]
        return [f"{prefix.rstrip('.').replace('_', ' ')}: {'; '.join(i for i in items if i)}"]
    return [f"{prefix.rstrip('.').replace('_', ' ')}: {value}"]


def section_text(soap: SoapNote, section: str) -> str:
    return "\n".join(_lines(getattr(soap, section).model_dump(mode="json")))


def note_text(soap: SoapNote) -> str:
    return "\n\n".join(f"{s.upper()}\n{t}" for s in SECTIONS if (t := section_text(soap, s)))


def note_chunks(soap: SoapNote, *, recording_id: str, encounter_date: str) -> list[HistoryChunk]:
    return [HistoryChunk(source="note", source_id=recording_id, part=s, date=encounter_date,
                         label=s.capitalize(), text=text)
            for s in SECTIONS if (text := section_text(soap, s))]


def document_chunks(text: str, *, document_id: str, date: str, label: str) -> list[HistoryChunk]:
    """Split on paragraph breaks into parts of about DOCUMENT_PART_CHARS characters."""
    parts: list[str] = []
    current = ""
    for para in (p.strip() for p in re.split(r"\n\s*\n", text)):
        if not para:
            continue
        if current and len(current) + len(para) > DOCUMENT_PART_CHARS:
            parts.append(current)
            current = ""
        current = f"{current}\n\n{para}" if current else para
        while len(current) > DOCUMENT_PART_CHARS:  # one huge paragraph
            parts.append(current[:DOCUMENT_PART_CHARS])
            current = current[DOCUMENT_PART_CHARS:]
    if current:
        parts.append(current)
    return [HistoryChunk(source="document", source_id=document_id, part=f"p{i}", date=date,
                         label=label, text=part)
            for i, part in enumerate(parts, 1)]


@dataclass
class PatientHistory:
    store: HistoryStore
    embedder: Embedder
    comparer: HistoryComparer
    reader: DocumentReader
    limit: int = 6

    def _index(self, patient: PatientKey, chunks: list[HistoryChunk]) -> int:
        if chunks:
            self.store.add(patient, chunks,
                           self.embedder.embed([c.text for c in chunks], task="document"))
        return len(chunks)

    def index_note(self, patient: PatientKey, soap: SoapNote, *, recording_id: str,
                   encounter_date: str) -> int:
        return self._index(patient, note_chunks(soap, recording_id=recording_id,
                                                encounter_date=encounter_date))

    def index_document(self, patient: PatientKey, *, document_id: str, file_bytes: bytes,
                       mime_type: str, date: str, label: str) -> int:
        text = self.reader.read(file_bytes=file_bytes, mime_type=mime_type)
        return self._index(patient, document_chunks(text, document_id=document_id, date=date,
                                                     label=label))

    def forget(self, patient: PatientKey, source_id: str) -> None:
        self.store.remove(patient, source_id)

    def interval_history(self, patient: PatientKey, soap: SoapNote, *,
                         recording_id: str) -> list[HistoryStatement]:
        query = "\n".join(t for s in ("subjective", "assessment") if (t := section_text(soap, s)))
        if not query:
            return []
        [vector] = self.embedder.embed([query], task="query")
        sources = self.store.search(patient, vector, limit=self.limit,
                                    exclude_source_id=recording_id)
        if not sources:
            return []
        by_id = {c.id: c for c in sources}
        statements, dropped = [], 0
        for text, cited_ids in self.comparer.compare(new_note=note_text(soap), sources=sources):
            cited = [by_id[i] for i in dict.fromkeys(cited_ids) if i in by_id]
            if not text.strip() or not cited:
                dropped += 1  # uncited or citing something that was never retrieved
                continue
            statements.append(HistoryStatement(text=text.strip(), sources=[
                HistorySource(source=c.source, source_id=c.source_id, date=c.date, label=c.label)
                for c in cited]))
        if dropped:
            logger.info("interval_history_dropped_uncited count=%d", dropped)  # no PHI
        return statements
