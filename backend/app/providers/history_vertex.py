"""Vertex AI + Firestore implementations of the patient-history interfaces.

Chunks live at organizations/{orgId}/clinics/{clinicId}/patients/{patientId}/
note_chunks/{chunkId} with a 768-dimension `embedding` vector field (index in
firebase/firestore.indexes.json). Searching one patient's subcollection is what
keeps another patient's history out of the results. Clients cannot read these
docs: firestore.rules has no match for them, so they fall under default deny.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any, Literal

from app.interfaces.history import HistoryChunk, PatientKey

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 768

_COMPARE_PROMPT = """You are writing the interval history for a follow-up clinical note: how today's visit compares with this patient's earlier visits and records.

EARLIER NOTES AND DOCUMENTS (each starts with its source id in brackets):
{sources}

TODAY'S NOTE:
{new_note}

Write at most 5 short statements comparing today with the earlier records: progress, changes in pain or function, response to earlier treatment, relevant past results, plan changes. Rules:
- Use only what today's note and the earlier records say. Never add facts, scores, doses or dates.
- Every statement must cite the id(s) of the earlier record(s) it relies on, copied exactly.
- If nothing earlier relates to today's visit, return an empty list.

Return JSON only: {{"statements": [{{"text": "...", "sources": ["id"]}}]}}
"""  # noqa: E501

_READ_PROMPT = """Transcribe all text in this medical document (lab report, prescription, discharge summary or past record) in reading order. Keep numbers, units, dates and drug names exactly as written. Separate sections with blank lines. Return only the text."""  # noqa: E501


def _patient_chunks(db: Any, patient: PatientKey) -> Any:
    return (db.collection("organizations").document(patient.org_id)
            .collection("clinics").document(patient.clinic_id)
            .collection("patients").document(patient.patient_id)
            .collection("note_chunks"))


class FirestoreHistoryStore:
    def __init__(self, get_db: Callable[[], Any]) -> None:
        self._get_db = get_db

    def add(self, patient: PatientKey, chunks: list[HistoryChunk],
            vectors: list[list[float]]) -> None:
        from google.cloud.firestore_v1.vector import Vector

        col = _patient_chunks(self._get_db(), patient)
        for chunk, vector in zip(chunks, vectors, strict=True):
            col.document(chunk.id).set({
                "source": chunk.source, "source_id": chunk.source_id, "part": chunk.part,
                "date": chunk.date, "label": chunk.label, "text": chunk.text,
                "embedding": Vector(vector),
            })

    def search(self, patient: PatientKey, vector: list[float], *, limit: int,
               exclude_source_id: str | None = None) -> list[HistoryChunk]:
        from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
        from google.cloud.firestore_v1.vector import Vector

        # Over-fetch by one note's four sections: the current recording's own
        # chunks are filtered out afterwards.
        query = _patient_chunks(self._get_db(), patient).find_nearest(
            vector_field="embedding", query_vector=Vector(vector),
            distance_measure=DistanceMeasure.COSINE, limit=limit + 4)
        found = []
        for snap in query.stream():
            d = snap.to_dict() or {}
            if d.get("source_id") == exclude_source_id:
                continue
            found.append(HistoryChunk(source=d["source"], source_id=d["source_id"],
                                      part=d["part"], date=d.get("date", ""),
                                      label=d.get("label", ""), text=d["text"]))
        return found[:limit]

    def remove(self, patient: PatientKey, source_id: str) -> None:
        col = _patient_chunks(self._get_db(), patient)
        for snap in col.where("source_id", "==", source_id).stream():
            col.document(snap.id).delete()


class VertexTextEmbedder:
    def __init__(self, *, model: str) -> None:
        self._model_name = model
        self._model: Any = None

    def embed(self, texts: list[str], *, task: Literal["document", "query"]) -> list[list[float]]:
        from vertexai.language_models import TextEmbeddingInput, TextEmbeddingModel

        if self._model is None:
            self._model = TextEmbeddingModel.from_pretrained(self._model_name)
        task_type = "RETRIEVAL_DOCUMENT" if task == "document" else "RETRIEVAL_QUERY"
        vectors: list[list[float]] = []
        for start in range(0, len(texts), 100):
            batch = [TextEmbeddingInput(t, task_type) for t in texts[start:start + 100]]
            vectors += [e.values for e in self._model.get_embeddings(
                batch, output_dimensionality=EMBEDDING_DIMENSIONS)]
        return vectors


class _GeminiJson:
    def __init__(self, *, model: str) -> None:
        self._model_name = model
        self._model: Any = None

    def _generate(self, contents: list[Any], *, json_output: bool) -> str:
        from vertexai.generative_models import GenerationConfig, GenerativeModel

        if self._model is None:
            self._model = GenerativeModel(self._model_name)
        config = GenerationConfig(temperature=0.1, max_output_tokens=8192,
                                  response_mime_type="application/json" if json_output else None)
        return str(self._model.generate_content(contents, generation_config=config).text)


class VertexGeminiHistoryComparer(_GeminiJson):
    def compare(self, *, new_note: str, sources: list[HistoryChunk]) -> list[tuple[str, list[str]]]:
        listing = "\n\n".join(f"[{c.id}] {c.date} · {c.label}\n{c.text}" for c in sources)
        data = json.loads(self._generate(
            [_COMPARE_PROMPT.format(sources=listing, new_note=new_note)], json_output=True))
        return [(str(s.get("text", "")), [str(i) for i in s.get("sources") or []])
                for s in data.get("statements") or [] if isinstance(s, dict)]


class VertexGeminiDocumentReader(_GeminiJson):
    def read(self, *, file_bytes: bytes, mime_type: str) -> str:
        from vertexai.generative_models import Part

        return self._generate([Part.from_data(file_bytes, mime_type=mime_type), _READ_PROMPT],
                              json_output=False)
