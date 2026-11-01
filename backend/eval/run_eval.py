"""Run the production audio → SOAP provider over the eval set and score it.

One Gemini call per visit plus one judge call per visit, about $0.04 per visit at list price.
  --backend vertex      `VertexGeminiAudioToSoap`, the exact code the upload endpoint uses
                        (needs billing on the Vertex project)
  --backend gemini-api  the same prompt and settings over the Gemini API with an AI Studio
                        key (free tier works; see eval/gemini_api.py)

Usage (from backend/, after `uv run python -m eval.prepare`):
    uv run python -m eval.run_eval --limit 20 --backend gemini-api
Writes eval/runs/<run>/report.md and scores.csv; raw model output stays in eval/.cache/.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.interfaces.audio_to_soap import AudioToSoapError
from app.providers.vertex_gemini import VertexGeminiAudioToSoap
from eval import gemini_api, metrics

HERE = Path(__file__).parent
# Vertex AI list prices, USD per 1M tokens (https://cloud.google.com/vertex-ai/pricing).
# Gemini bills audio input at a higher rate than text: 32 tokens per second of audio.
PRICES = {
    "gemini-2.5-flash": {"text": 0.30, "audio": 1.00, "output": 2.50},
    "gemini-2.5-pro": {"text": 1.25, "audio": 1.25, "output": 10.00},
    # Introductory price through 2026-12-31; $1.50 / $7.50 from 2027.
    "gemini-3.8-flash": {"text": 0.75, "audio": 0.75, "output": 3.75},
    "gemini-3.1-pro-preview": {"text": 2.00, "audio": 2.00, "output": 12.00},
}
AUDIO_TOKENS_PER_SECOND = 32


def cost_usd(model: str, prompt_tokens: int, output_tokens: int, audio_s: float = 0) -> float:
    p = PRICES[model]
    audio = min(prompt_tokens, int(audio_s * AUDIO_TOKENS_PER_SECOND))
    return ((prompt_tokens - audio) * p["text"] + audio * p["audio"]
            + output_tokens * p["output"]) / 1_000_000


Ask = Callable[[str], tuple[dict[str, Any], int, int]]


def generate(provider: Any, model: str, case: dict[str, Any], raw_dir: Path) -> dict[str, Any]:
    row: dict[str, Any] = {"id": case["id"], "audio_s": case["duration_s"]}
    t0 = time.perf_counter()
    try:
        result = provider.process(audio_bytes=Path(case["audio"]).read_bytes(),
                                  mime_type="audio/mp4",
                                  encounter_date_iso=date.today().isoformat())
    except AudioToSoapError as e:
        row.update(ok=False, error=e.code, latency_s=round(time.perf_counter() - t0, 1))
        return row
    soap = result.soap.model_dump(mode="json")
    row.update(ok=True, error="", latency_s=round(time.perf_counter() - t0, 1),
               cost_usd=cost_usd(model, result.prompt_tokens or 0, result.output_tokens or 0,
                                 case["duration_s"]),
               wer=round(metrics.wer(case["dialogue"], result.transcript), 3),
               ungrounded=metrics.ungrounded_values(soap, case["dialogue"]))
    (raw_dir / f"{case['id']}.json").write_text(
        json.dumps({"transcript": result.transcript, "soap": soap}, indent=1))
    return row


def vertex_ask(model_name: str) -> Ask:
    from vertexai.generative_models import GenerationConfig, GenerativeModel

    model = GenerativeModel(model_name)

    def ask(prompt: str) -> tuple[dict[str, Any], int, int]:
        r = model.generate_content(prompt, generation_config=GenerationConfig(
            response_mime_type="application/json", temperature=0, max_output_tokens=32768))
        u = r.usage_metadata
        thinking = getattr(u, "thoughts_token_count", 0) or 0
        return json.loads(r.text), u.prompt_token_count, u.candidates_token_count + thinking

    return ask


def judge(ask: Ask, judge_name: str, case: dict[str, Any], raw_dir: Path) -> dict[str, Any]:
    cached = raw_dir / f"{case['id']}.judge-{judge_name}.json"
    if cached.exists():  # already paid for; reuse the verdict
        return metrics.judge_scores(json.loads(cached.read_text()))
    soap = json.loads((raw_dir / f"{case['id']}.json").read_text())["soap"]
    try:
        verdict, prompt_tokens, output_tokens = ask(
            metrics.judge_prompt(case["dialogue"], case["reference_note"], soap))
    except (AudioToSoapError, json.JSONDecodeError):
        return {}  # left out of the judged totals; the report counts judged visits
    cached.write_text(json.dumps(verdict, indent=1))
    scores = metrics.judge_scores(verdict)
    scores["judge_cost_usd"] = cost_usd(judge_name, prompt_tokens, output_tokens)
    return scores


def load_generation(raw_dir: Path, legacy_dir: Path,
                    cases: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Generation results of an earlier run, with the model-free checks re-run."""
    saved = raw_dir / "generation.json"
    rows = list(json.loads(saved.read_text())) if saved.exists() else _legacy_rows(legacy_dir)
    for r in rows:
        if r["ok"]:
            out = json.loads((raw_dir / f"{r['id']}.json").read_text())
            dialogue = cases[r["id"]]["dialogue"]
            r["wer"] = round(metrics.wer(dialogue, out["transcript"]), 3)
            r["ungrounded"] = metrics.ungrounded_values(out["soap"], dialogue)
    return rows


def _legacy_rows(legacy_dir: Path) -> list[dict[str, Any]]:
    """Runs from before generation.json was saved only left a scores.csv."""
    rows = []
    for r in csv.DictReader((legacy_dir / "scores.csv").open()):
        ok = r["ok"] == "True"
        rows.append({"id": r["id"], "audio_s": float(r["audio_s"]), "ok": ok, "error": r["error"],
                     "latency_s": float(r["latency_s"]),
                     "cost_usd": float(r["cost_usd"]) if ok else 0.0,
                     "wer": float(r["wer"]) if ok else 0.0,
                     "ungrounded": [x for x in r["ungrounded"].split("; ") if x]})
    return rows


def report(rows: list[dict[str, Any]], model: str, judge_name: str, backend: str) -> str:
    ok = [r for r in rows if r["ok"]]
    judged = [r for r in ok if "claims" in r]
    claims = sum(r["claims"] for r in judged)
    unsupported = sum(r["unsupported"] for r in judged)
    contradicted = sum(r["contradicted"] for r in judged)
    facts = sum(r["reference_facts"] for r in judged)
    covered = sum(r["facts_covered"] for r in judged)
    if not ok:
        return f"# Audio → SOAP eval: {model}\n\nNo notes generated.\n"
    lat = sorted(r["latency_s"] for r in ok)
    p95 = lat[min(len(lat) - 1, round(0.95 * (len(lat) - 1)))]
    audio_min = statistics.mean(r["audio_s"] for r in rows) / 60
    lines = [
        f"# Audio → SOAP eval: {model}",
        "",
        f"{len(rows)} ACI-Bench visits (test set 1, CC BY 4.0), voiced with macOS TTS, "
        f"average {audio_min:.1f} min of audio. Backend: {backend}. Judge: {judge_name} "
        f"({len(judged)} visits judged). Run {date.today()}.",
        "",
        "| Metric | Result |",
        "|---|---|",
        f"| Notes generated and schema-valid | {len(ok)}/{len(rows)} |",
        f"| Transcript word error rate (mean) | {statistics.mean(r['wer'] for r in ok):.1%} |",
        f"| Reference facts captured | {covered}/{facts} ({covered / max(facts, 1):.1%}) |",
        f"| Note claims not supported by the visit | {unsupported}/{claims} "
        f"({unsupported / max(claims, 1):.1%}) |",
        f"| Note claims contradicting the visit | {contradicted}/{claims} "
        f"({contradicted / max(claims, 1):.1%}) |",
        f"| Vitals/doses whose numbers were never said | "
        f"{sum(len(r['ungrounded']) for r in ok)} |",
        f"| Latency p50 / p95 | {statistics.median(lat):.1f} s / {p95:.1f} s |",
        f"| Generation cost per note at list price (mean) | "
        f"${statistics.mean(r['cost_usd'] for r in ok):.4f} |",
        "",
        "Failures: " + (", ".join(f"{r['id']} ({r['error']})" for r in rows if not r["ok"])
                        or "none"),
    ]
    flagged = [f"- {r['id']}: {v}" for r in ok for v in r["ungrounded"]]
    if flagged:
        lines += ["", "Numbers in notes that were never said:", *flagged]
    lines += ["", "Caveats: synthetic TTS audio is cleaner than a real clinic; English only "
              "(the app also handles Hindi, Telugu and Kannada); the judge is an LLM and its "
              "labels were spot-checked, not fully audited."]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--judge", default="gemini-2.5-pro")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--backend", choices=["vertex", "gemini-api"], default="vertex")
    ap.add_argument("--judge-only", action="store_true",
                    help="re-judge the notes already generated for this model and backend")
    args = ap.parse_args()

    settings = get_settings()
    model = settings.vertex_model
    cases = [json.loads(line) for line in (HERE / ".cache" / "cases.jsonl").open()][: args.limit]
    run = f"{date.today()}-{model}-{args.backend}"
    raw_dir = HERE / ".cache" / "runs" / run
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir = HERE / "runs" / f"{run}-judge-{args.judge}"
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.backend == "vertex":
        import vertexai

        vertexai.init(project=settings.vertex_project_id, location=settings.vertex_location)
        provider: Any = VertexGeminiAudioToSoap(project=settings.vertex_project_id,
                                                location=settings.vertex_location, model=model)
        ask = vertex_ask(args.judge)
    else:
        provider = gemini_api.GeminiApiAudioToSoap(model)

        def ask(prompt: str) -> tuple[dict[str, Any], int, int]:
            return gemini_api.ask_json(args.judge, prompt)

    if args.judge_only:
        rows = load_generation(raw_dir, HERE / "runs" / run, {c["id"]: c for c in cases})
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            rows = list(pool.map(lambda c: generate(provider, model, c, raw_dir), cases))
        (raw_dir / "generation.json").write_text(json.dumps(rows, indent=1))
    print(f"generated {sum(r['ok'] for r in rows)}/{len(rows)}")

    by_id = {c["id"]: c for c in cases}
    ok_rows = [r for r in rows if r["ok"]]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        verdicts = list(pool.map(lambda r: judge(ask, args.judge, by_id[r["id"]], raw_dir),
                                 ok_rows))
    for r, v in zip(ok_rows, verdicts, strict=True):
        r.update(v)

    fields = ["id", "audio_s", "ok", "error", "latency_s", "cost_usd", "wer", "claims",
              "unsupported", "contradicted", "reference_facts", "facts_covered", "ungrounded"]
    with (out_dir / "scores.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({**r, "ungrounded": "; ".join(r.get("ungrounded", []))})
    text = report(rows, model, args.judge, args.backend)
    (out_dir / "report.md").write_text(text)
    spent = sum(r.get("cost_usd", 0) + r.get("judge_cost_usd", 0) for r in rows)
    print(text)
    print(f"eval spend ≈ ${spent:.2f}")


if __name__ == "__main__":
    main()
