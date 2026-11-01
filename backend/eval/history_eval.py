"""Score the patient-history RAG on the synthetic multi-visit patients.

For every patient, the earlier visits (including the unrelated one) and both
documents are indexed with the production embedder into one shared in-memory
store, then `PatientHistory.interval_history` runs on today's note with the
production comparer and retrieval settings. Scored:
  - retrieval recall: share of the records the expected facts need that reached the comparer
  - distractors: the unrelated visit or report passed to the comparer, or cited
  - leakage: chunks from another patient passed to the comparer (must be 0)
  - statements a judge finds supported, and expected facts covered or partly covered
  - statements the citation guardrail dropped

Usage (from backend/, after eval.history_cases):
    uv run python -m eval.history_eval --project <vertex project>
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
from datetime import date
from pathlib import Path
from typing import Any

from app.interfaces.history import HistoryChunk, PatientKey
from app.models.soap import SoapNote
from app.providers.history_memory import InMemoryHistoryStore
from app.services.patient_history import PatientHistory, note_text
from eval.run_eval import cost_usd

HERE = Path(__file__).parent

JUDGE_PROMPT = """You are checking the interval history of a follow-up clinical note. Each statement cites earlier records.

TODAY'S NOTE:
{today}

STATEMENTS (with the text of the records each one cites):
{statements}

EXPECTED FACTS (what a good interval history should say):
{expected}

Return JSON only:
{{"statements": [{{"index": 0, "label": "supported"}}], "expected": [{{"index": 0, "coverage": "covered"}}]}}
- label each statement:
  "supported": today's note plus its cited records back every part of it;
  "unsupported": it adds or guesses something they do not say;
  "contradicted": it conflicts with them;
  "misleading": every part is in the records, but read as the patient's current status it is wrong (e.g. an earlier dose presented as what the patient takes now, when today's note says it stopped).
- coverage of each expected fact:
  "covered": a statement makes the same comparison with its key values; a comparison against a different earlier visit than the fact names still counts;
  "partial": a statement makes the comparison without the key values, or covers only part of the fact;
  "missing": no statement conveys it.
"""


class TextReader:
    """Documents in the synthetic cases are already text."""

    def read(self, *, file_bytes: bytes, mime_type: str) -> str:
        return file_bytes.decode()


class RecordingComparer:
    """Wraps the real comparer to keep what was retrieved and what it answered."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.seen: list[HistoryChunk] = []
        self.raw: list[tuple[str, list[str]]] = []

    def compare(self, *, new_note: str, sources: list[HistoryChunk]) -> list[tuple[str, list[str]]]:
        self.seen = sources
        self.raw = self.inner.compare(new_note=new_note, sources=sources)
        return self.raw


def run_patient(case: dict[str, Any], store: InMemoryHistoryStore, embedder: Any,
                comparer_model: Any) -> dict[str, Any]:
    pid = case["id"]
    key = PatientKey("eval-org", "eval-clinic", pid)
    comparer = RecordingComparer(comparer_model)
    history = PatientHistory(store=store, embedder=embedder, comparer=comparer,
                             reader=TextReader())  # production retrieval settings
    today = SoapNote.model_validate(case["today"])
    t0 = time.perf_counter()
    statements = history.interval_history(key, today, recording_id=f"{pid}-today")
    latency = time.perf_counter() - t0
    needed = {s for e in case["expected"] for s in e["sources"]}
    distractors = {f"{pid}-v3", f"{pid}-d2"}
    retrieved = {c.source_id for c in comparer.seen}
    return {
        "id": pid, "condition": case["condition"], "latency_s": round(latency, 1),
        "retrieved": len(retrieved),
        "needed": len(needed),
        "needed_retrieved": len({f"{pid}-{s}" for s in needed} & retrieved),
        "distractor_retrieved": len(retrieved & distractors),
        "leaked": sum(not c.source_id.startswith(f"{pid}-") for c in comparer.seen),
        "statements": [s.model_dump(mode="json") for s in statements],
        "dropped": len(comparer.raw) - len(statements),
        "distractor_cited": sum(any(src.source_id in distractors for src in s.sources)
                                for s in statements),
        "sources_text": {c.id: c.text for c in comparer.seen},
        "cited_ids": [[f"{src.source}-{src.source_id}-" for src in s.sources] for s in statements],
    }


def judge(model: Any, case: dict[str, Any], row: dict[str, Any]) -> dict[str, float]:
    from vertexai.generative_models import GenerationConfig

    lines = []
    for i, s in enumerate(row["statements"]):
        cited = [text for cid, text in row["sources_text"].items()
                 if any(cid.startswith(prefix) for prefix in row["cited_ids"][i])]
        lines.append(f"[{i}] {s['text']}\n    cites:\n    " + "\n    ".join(cited))
    expected = "\n".join(f"[{i}] {e['fact']}" for i, e in enumerate(case["expected"]))
    response = model.generate_content(
        JUDGE_PROMPT.format(today=note_text(SoapNote.model_validate(case["today"])),
                            statements="\n".join(lines) or "(none)", expected=expected),
        generation_config=GenerationConfig(response_mime_type="application/json",
                                           temperature=0, max_output_tokens=16384))
    verdict = json.loads(response.text)
    u = response.usage_metadata
    spent = cost_usd(model._model_name.split("/")[-1], u.prompt_token_count,
                     u.candidates_token_count + (getattr(u, "thoughts_token_count", 0) or 0))
    labels = [str(s.get("label", "")).lower() for s in verdict.get("statements") or []]
    coverage = [str(e.get("coverage", "")).lower() for e in verdict.get("expected") or []]
    return {"supported": labels.count("supported"), "unsupported": labels.count("unsupported"),
            "contradicted": labels.count("contradicted"), "misleading": labels.count("misleading"),
            "labels": labels, "coverage": coverage,
            "expected_covered": coverage.count("covered"),
            "expected_partial": coverage.count("partial"),
            "judge_cost_usd": spent}


def report(rows: list[dict[str, Any]], args: argparse.Namespace) -> str:
    def total(k: str) -> int:
        return sum(int(r.get(k, 0)) for r in rows)

    stmts = sum(len(r["statements"]) for r in rows)
    expected = sum(r["expected_total"] for r in rows)
    pct = lambda a, b: f"{a}/{b} ({a / max(b, 1):.1%})"  # noqa: E731
    return "\n".join([
        f"# Patient-history RAG eval: {args.comparer}",
        "",
        f"{len(rows)} synthetic physiotherapy patients ({args.cases_model}-written), each with 2 "
        "earlier visits, 1 unrelated visit, 1 relevant and 1 unrelated scanned report. "
        f"Embeddings: {args.embedding_model}; up to {PatientHistory.note_records} earlier visits "
        f"in full + {PatientHistory.document_parts} report parts; judge: {args.judge}. "
        f"Run {date.today()}.",
        "",
        "| Metric | Result |",
        "|---|---|",
        f"| Records needed by expected facts that reached the comparer | "
        f"{pct(total('needed_retrieved'), total('needed'))} |",
        f"| Expected facts stated with their values | {pct(total('expected_covered'), expected)} |",
        f"| Expected facts stated, values missing or only in part | "
        f"{pct(total('expected_partial'), expected)} |",
        f"| Statements supported by their citations | {pct(total('supported'), stmts)} |",
        f"| Statements unsupported / contradicted / misleading | {total('unsupported')} / "
        f"{total('contradicted')} / {total('misleading')} |",
        f"| Statements citing the unrelated visit or report | {total('distractor_cited')} |",
        f"| Unrelated visit or report passed to the comparer | "
        f"{pct(total('distractor_retrieved'), 2 * len(rows))} |",
        f"| Chunks from another patient passed to the comparer | {total('leaked')} |",
        f"| Statements dropped by the citation guardrail | {total('dropped')} |",
        f"| Latency per follow-up (median) | {statistics.median(r['latency_s'] for r in rows):.1f} s |",
        "",
        "Caveats: patients and expected facts are LLM-written; the judge is an LLM and its "
        "labels should be spot-checked. With only 3 earlier visits and 2 reports per patient, "
        "the visit and report caps exclude little, so this mostly tests the comparer, not "
        "retrieval ranking.",
    ]) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--location", default="us-central1", help="embeddings + comparer")
    ap.add_argument("--comparer", default="gemini-2.5-flash")
    ap.add_argument("--embedding-model", default="text-embedding-005")
    ap.add_argument("--judge", default="gemini-3.1-pro-preview")
    ap.add_argument("--judge-location", default="global")
    ap.add_argument("--cases-model", default="gemini-3.1-pro-preview")
    ap.add_argument("--tag", default="", help="suffix for the run folder, e.g. v2")
    args = ap.parse_args()

    import vertexai
    from vertexai.generative_models import GenerativeModel

    from app.providers.history_vertex import VertexGeminiHistoryComparer, VertexTextEmbedder

    cases = json.loads((HERE / ".cache" / "history_cases.json").read_text())

    # Phase 1: index every patient into one shared store, then compare follow-ups.
    vertexai.init(project=args.project, location=args.location)
    store = InMemoryHistoryStore()
    embedder = VertexTextEmbedder(model=args.embedding_model)
    indexer = PatientHistory(store=store, embedder=embedder, comparer=None,  # type: ignore[arg-type]
                             reader=TextReader())
    for case in cases:
        key = PatientKey("eval-org", "eval-clinic", case["id"])
        for visit in case["visits"]:
            soap = SoapNote.model_validate(visit["soap"])
            indexer.index_note(key, soap, recording_id=f"{case['id']}-{visit['id']}",
                               encounter_date=soap.patient.encounter_date.isoformat())
        for doc in case["documents"]:
            indexer.index_document(key, document_id=f"{case['id']}-{doc['id']}",
                                   file_bytes=doc["text"].encode(), mime_type="text/plain",
                                   date=doc["date"], label=doc["label"])
    comparer = VertexGeminiHistoryComparer(model=args.comparer)
    rows = [run_patient(case, store, embedder, comparer) for case in cases]

    # Phase 2: judge (Pro models are served from the global endpoint).
    vertexai.init(project=args.project, location=args.judge_location)
    judge_model = GenerativeModel(args.judge)
    for case, row in zip(cases, rows, strict=True):
        row.update(judge(judge_model, case, row), expected_total=len(case["expected"]))

    run = f"{date.today()}-history-{args.comparer}" + (f"-{args.tag}" if args.tag else "")
    raw = HERE / ".cache" / "runs" / run
    raw.mkdir(parents=True, exist_ok=True)
    (raw / "rows.json").write_text(json.dumps(rows, indent=1))
    out = HERE / "runs" / run
    out.mkdir(parents=True, exist_ok=True)
    fields = ["id", "condition", "retrieved", "needed", "needed_retrieved", "distractor_retrieved",
              "leaked", "dropped", "distractor_cited", "supported", "unsupported", "contradicted",
              "misleading", "expected_covered", "expected_partial", "expected_total", "latency_s"]
    with (out / "scores.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    text = report(rows, args)
    (out / "report.md").write_text(text)
    print(text)
    print(f"judge cost: ${sum(r['judge_cost_usd'] for r in rows):.2f}")


if __name__ == "__main__":
    main()
