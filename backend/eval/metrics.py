"""Scoring for the audio → SOAP eval.

Three independent checks, cheapest first:
  - word error rate of the transcript against the source dialogue (no model);
  - vitals and doses in the note whose numbers never appear in the conversation (no model);
  - an LLM judge that splits the note into atomic claims, labels each against the
    conversation, and checks which of the reference note's key facts were captured.
"""
from __future__ import annotations

import json
import re
from typing import Any

# ─── Transcript accuracy ────────────────────────────────────────────


def words(text: str) -> list[str]:
    text = re.sub(r"\[\w+\]", " ", text.lower())
    text = text.replace("%", " percent ").replace("-", " ")
    return re.findall(r"[a-z0-9']+(?:\.[0-9]+)?", text)


def wer(reference: str, hypothesis: str) -> float:
    """Word error rate: (substitutions + insertions + deletions) / reference words."""
    ref, hyp = words(reference), words(hypothesis)
    if not ref:
        return 0.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1] / len(ref)


# ─── Numbers that must come from the conversation ───────────────────

_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_UNITS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
         "eighty": 80, "ninety": 90}
_SCALES = {"hundred", "thousand"}
_JOINERS = {"and", "point", "."}
# The note stores metric units; the visit may have said pounds, inches or °F.
_CONVERSIONS = {"vitals.weight_kg": lambda lb: lb / 2.2046,
                "vitals.height_cm": lambda inch: inch * 2.54,
                "vitals.temperature_c": lambda f: (f - 32) * 5 / 9}


def _word_value(tokens: list[str]) -> float | None:
    """Plain English reading: "a hundred and eighty" → 180, "ninety eight . one" → 98.1."""
    total = cur = 0
    for i, t in enumerate(tokens):
        if t in ("point", "."):
            digits = [_UNITS.get(x) for x in tokens[i + 1:]]
            if not digits or any(d is None or d > 9 for d in digits):
                return None
            return total + cur + float("0." + "".join(str(d) for d in digits))
        if t in _UNITS:
            cur += _UNITS[t]
        elif t in _TENS:
            cur += _TENS[t]
        elif t == "hundred":
            cur = (cur or 1) * 100
        elif t == "thousand":
            total, cur = total + (cur or 1) * 1000, 0
    return float(total + cur)


def spoken_numbers(dialogue: str) -> set[float]:
    """Every number said in the visit, as digits or words.

    Besides plain readings, clinicians say "one twenty over seventy" for 120/70, so a
    digit word followed by a two-digit number also counts as hundreds. Every stretch of
    consecutive number words is read, which errs toward calling a number spoken.
    """
    found = {float(n) for n in _NUMBER.findall(dialogue)}
    tokens = re.findall(r"[a-z]+|\.", dialogue.lower())
    run: list[str] = []
    for t in [*tokens, ""]:
        if t in _UNITS or t in _TENS or t in _SCALES or t == "a" or (run and t in _JOINERS):
            run.append(t)
            continue
        for i in range(len(run)):
            for j in range(i + 1, min(i + 6, len(run)) + 1):
                part = run[i:j]
                if part[0] in _JOINERS or (part[0] == "a" and part[1:2] not in (["hundred"],
                                                                               ["thousand"])):
                    continue
                value = _word_value(part)
                if value is not None:
                    found.add(value)
                rest = _word_value(part[1:]) if len(part) > 1 else None
                if part[0] in _UNITS and 1 <= _UNITS[part[0]] <= 9 and rest and 10 <= rest < 100:
                    found.add(_UNITS[part[0]] * 100 + rest)
        run = []
    return found


def _grounded(label: str, value: float, spoken: set[float]) -> bool:
    convert = _CONVERSIONS.get(label)
    for s in spoken:
        if abs(s - value) <= 0.01 * max(abs(s), 1):
            return True
        if convert and abs(convert(s) - value) <= 0.02 * max(abs(value), 1):
            return True
    return False


def ungrounded_values(soap: dict[str, Any], dialogue: str) -> list[str]:
    """Vitals and medication doses whose numbers were never said in the visit."""
    spoken = spoken_numbers(dialogue)
    checks: list[tuple[str, str]] = []
    for field, value in (soap.get("objective", {}).get("vitals") or {}).items():
        if value is not None:
            checks.append((f"vitals.{field}", str(value)))
    meds = (soap.get("subjective", {}).get("current_medications") or []) + (
        soap.get("plan", {}).get("medications") or [])
    for med in meds:
        if med.get("dose"):
            checks.append((f"dose of {med.get('name')}", str(med["dose"])))
    bad = []
    for label, value in checks:
        nums = [float(n) for n in _NUMBER.findall(value)]
        if any(not _grounded(label, n, spoken) for n in nums):
            bad.append(f"{label} = {value}")
    return bad


# ─── LLM judge ──────────────────────────────────────────────────────

JUDGE_PROMPT = """You are checking an AI-generated clinical SOAP note against the doctor-patient conversation it was made from.

CONVERSATION (the only ground truth):
{dialogue}

REFERENCE NOTE (written by a clinician from the same conversation):
{reference}

GENERATED NOTE (JSON):
{generated}

Return JSON only, with two lists:

1. "claims": split the GENERATED note into atomic clinical statements, one fact each (a symptom, a history item, a medication with its dose, a vital sign, an exam finding, a result, a diagnosis, a test, a referral, a follow-up instruction). Skip empty fields, the patient's name and the date. Label each:
   - "supported": stated in the conversation, or a faithful clinical restatement of it
   - "unsupported": not in the conversation (added, guessed or over-interpreted)
   - "contradicted": conflicts with the conversation
   For "supported" and "contradicted", quote the conversation in "evidence".

2. "reference_facts": the key clinical facts in the REFERENCE note, at most 25 (chief complaint, important history, exam findings, results, each diagnosis, each plan item). Set "covered" to true when the generated note states the same fact, in any wording.

{{"claims": [{{"claim": "...", "label": "supported", "evidence": "..."}}],
 "reference_facts": [{{"fact": "...", "covered": true}}]}}
"""


def judge_prompt(dialogue: str, reference: str, soap: dict[str, Any]) -> str:
    note = {k: soap.get(k) for k in ("patient", "subjective", "objective", "assessment", "plan")}
    return JUDGE_PROMPT.format(dialogue=dialogue, reference=reference,
                               generated=json.dumps(note, indent=1, default=str))


def judge_scores(verdict: dict[str, Any]) -> dict[str, Any]:
    claims = verdict.get("claims") or []
    facts = verdict.get("reference_facts") or []
    labels = [str(c.get("label", "")).lower() for c in claims]
    return {
        "claims": len(claims),
        "unsupported": labels.count("unsupported"),
        "contradicted": labels.count("contradicted"),
        "reference_facts": len(facts),
        "facts_covered": sum(bool(f.get("covered")) for f in facts),
    }
