"""Patient-history RAG: chunking, per-patient retrieval and the citation guardrail.

Offline: a hashing embedder and a scripted comparer stand in for Vertex AI.
"""
from __future__ import annotations

import hashlib
import math
from datetime import date

from app.interfaces.history import HistoryChunk, PatientKey
from app.models.soap import Assessment, PatientMeta, Plan, SoapNote, Subjective
from app.providers.history_memory import InMemoryHistoryStore
from app.services.patient_history import (
    DOCUMENT_PART_CHARS,
    PatientHistory,
    document_chunks,
    note_chunks,
)

ALICE = PatientKey("org1", "clinic-a", "alice")
BOB = PatientKey("org1", "clinic-a", "bob")


class HashEmbedder:
    """Bag-of-words vectors: texts sharing words land close together."""

    def embed(self, texts, *, task):
        out = []
        for text in texts:
            v = [0.0] * 64
            for word in text.lower().split():
                v[int(hashlib.md5(word.encode()).hexdigest(), 16) % 64] += 1.0
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / norm for x in v])
        return out


class ScriptedComparer:
    def __init__(self, answer):
        self.answer = answer
        self.seen: list[HistoryChunk] = []

    def compare(self, *, new_note, sources):
        self.seen = sources
        return self.answer(sources)


class TextReader:
    def read(self, *, file_bytes, mime_type):
        return file_bytes.decode()


def knee_note(pain: str, plan: str) -> SoapNote:
    return SoapNote(
        patient=PatientMeta(encounter_date=date(2026, 6, 28)),
        subjective=Subjective(chief_complaint="right knee pain", history_present_illness=pain),
        assessment=Assessment(diagnoses=["patellofemoral pain syndrome"]),
        plan=Plan(follow_up=plan),
    )


def make_history(answer=lambda sources: []):
    comparer = ScriptedComparer(answer)
    history = PatientHistory(store=InMemoryHistoryStore(), embedder=HashEmbedder(),
                             comparer=comparer, reader=TextReader())
    return history, comparer


def test_note_chunks_one_per_filled_section():
    chunks = note_chunks(knee_note("pain 6/10 on stairs", "review in 2 weeks"),
                         recording_id="r1", encounter_date="2026-06-28")
    assert [c.part for c in chunks] == ["subjective", "assessment", "plan"]  # objective empty
    assert "pain 6/10 on stairs" in chunks[0].text
    assert chunks[0].id == "note-r1-subjective"


def test_document_chunks_split_on_paragraphs_and_cap_size():
    text = "\n\n".join(f"Paragraph {i} " + "x" * 500 for i in range(5))
    chunks = document_chunks(text, document_id="d1", date="2026-05-01", label="MRI report")
    assert len(chunks) > 1
    assert all(len(c.text) <= DOCUMENT_PART_CHARS for c in chunks)
    assert [c.part for c in chunks] == [f"p{i}" for i in range(1, len(chunks) + 1)]
    assert chunks[0].label == "MRI report"


def test_search_never_returns_another_patients_history():
    history, comparer = make_history()
    history.index_note(BOB, knee_note("knee pain 8/10", "ice"), recording_id="bob-1",
                       encounter_date="2026-06-01")
    statements = history.interval_history(ALICE, knee_note("knee pain 3/10", "continue"),
                                          recording_id="alice-2")
    assert statements == []
    assert comparer.seen == []  # Bob's identical-looking note was never retrieved


def test_follow_up_cites_earlier_note_and_scanned_document():
    history, _ = make_history(lambda sources: [
        ("Knee pain improved from 6/10 to 3/10.", ["note-alice-1-subjective"]),
        ("Earlier MRI showed no meniscal tear.", [c.id for c in sources if c.source == "document"]),
    ])
    history.index_note(ALICE, knee_note("knee pain 6/10 on stairs", "quad strengthening"),
                       recording_id="alice-1", encounter_date="2026-06-28")
    history.index_document(ALICE, document_id="mri", file_bytes=b"MRI right knee: no meniscal tear",
                           mime_type="application/pdf", date="2026-06-20", label="MRI right knee")
    statements = history.interval_history(ALICE, knee_note("knee pain 3/10 on stairs", "continue"),
                                          recording_id="alice-2")
    assert [s.text for s in statements] == ["Knee pain improved from 6/10 to 3/10.",
                                           "Earlier MRI showed no meniscal tear."]
    assert statements[0].sources[0].source_id == "alice-1"
    assert statements[1].sources[0].label == "MRI right knee"


def test_uncited_or_unknown_citations_are_dropped():
    history, _ = make_history(lambda sources: [
        ("Pain has improved.", []),                       # no citation
        ("Swelling resolved.", ["note-someone-else-plan"]),  # never retrieved
        ("Plan unchanged.", ["note-alice-1-plan", "note-alice-1-plan"]),
    ])
    history.index_note(ALICE, knee_note("knee pain 6/10", "quad strengthening"),
                       recording_id="alice-1", encounter_date="2026-06-28")
    statements = history.interval_history(ALICE, knee_note("knee pain 4/10", "quad strengthening"),
                                          recording_id="alice-2")
    assert [s.text for s in statements] == ["Plan unchanged."]
    assert len(statements[0].sources) == 1  # duplicate citation collapsed


def test_current_note_and_deleted_documents_are_not_retrieved():
    history, comparer = make_history()
    history.index_note(ALICE, knee_note("knee pain 3/10", "continue"), recording_id="alice-2",
                       encounter_date="2026-07-12")
    history.index_document(ALICE, document_id="old-xray", file_bytes=b"knee x-ray normal",
                           mime_type="image/png", date="2026-06-01", label="X-ray")
    history.forget(ALICE, "old-xray")
    history.interval_history(ALICE, knee_note("knee pain 3/10", "continue"),
                             recording_id="alice-2")
    assert comparer.seen == []
