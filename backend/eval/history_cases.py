"""Generate synthetic multi-visit patients for the patient-history (RAG) eval.

ACI-Bench has one visit per patient, so each case here is written by an LLM:
two earlier visits for the main complaint, one unrelated visit (distractor), a
relevant scanned report and an irrelevant one, today's follow-up note, and the
facts a good interval history should mention with the records they come from.
Every SOAP note is validated against the app's `SoapNote` schema.

Usage (from backend/, Vertex billing on):
    uv run python -m eval.history_cases --n 12
Writes eval/.cache/history_cases.json. About $0.03 per patient.
"""
from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.models.soap import SoapNote
from eval.run_eval import cost_usd

CACHE = Path(__file__).parent / ".cache"
CONDITIONS = [
    "patellofemoral pain, right knee", "mechanical low back pain", "frozen shoulder, left",
    "lateral ankle sprain rehab", "tennis elbow, right", "neck pain with desk work",
    "6 weeks after ACL reconstruction", "plantar fasciitis", "rotator cuff tendinopathy",
    "hip osteoarthritis", "carpal tunnel syndrome", "lumbar radiculopathy (sciatica)",
]
SOAP_SHAPE = """{"patient": {"name": "", "age": 45, "sex": "female", "encounter_date": "YYYY-MM-DD"},
 "subjective": {"chief_complaint": "...", "history_present_illness": "...", "symptoms": [], "relevant_history": null, "current_medications": [{"name": "...", "dose": null, "route": null, "frequency": null, "duration": null, "notes": null}], "allergies": []},
 "objective": {"vitals": {"blood_pressure": null, "heart_rate_bpm": null, "respiratory_rate": null, "temperature_c": null, "spo2_percent": null, "weight_kg": null, "height_cm": null, "pain_scale_0_10": 6}, "physical_exam": "...", "findings": [], "labs_reviewed": []},
 "assessment": {"impressions": [], "diagnoses": ["..."]},
 "plan": {"medications": [], "tests_ordered": [], "procedures": [], "follow_up": "...", "patient_education": null, "referrals": []}}"""
PROMPT = """Write a realistic synthetic outpatient physiotherapy record for one patient whose main problem is: {condition}.

Return JSON only with this shape:
{{"visits": [{{"id": "v1", "case": "main", "soap": SOAP}}, {{"id": "v2", "case": "main", "soap": SOAP}}, {{"id": "v3", "case": "other", "soap": SOAP}}],
  "documents": [{{"id": "d1", "relevant": true, "date": "YYYY-MM-DD", "label": "...", "text": "..."}}, {{"id": "d2", "relevant": false, "date": "YYYY-MM-DD", "label": "...", "text": "..."}}],
  "today": SOAP,
  "expected": [{{"fact": "...", "sources": ["v1"]}}]}}

where every SOAP is a note with exactly this structure (null or [] when not stated):
{shape}

Requirements:
- v1 is the first visit for the main problem, v2 a follow-up 2-3 weeks later, and "today" a second follow-up 2-3 weeks after v2. Give each a different encounter_date, in order.
- Track concrete, changing details across v1, v2 and today: pain score, range of motion or strength numbers, exercises prescribed, any medication and dose.
- v3 is an unrelated visit for a different minor problem (case "other"), dated between v1 and today.
- d1 is a scanned imaging or specialist report relevant to the main problem, with specific findings (6-12 lines). d2 is an unrelated old record (for example a routine blood test). Write them as plain report text.
- "today" must not restate the earlier values; a clinician would need the earlier records to see the change.
- "expected": 3-5 facts a good interval history for today should state, each comparing today with earlier records, with the ids of the records it needs (v1, v2 or d1). Never cite v3 or d2.
"""


def generate(model: Any, condition: str, index: int,
             spent: list[float]) -> dict[str, Any] | None:
    from vertexai.generative_models import GenerationConfig

    response = model.generate_content(
        PROMPT.format(condition=condition, shape=SOAP_SHAPE),
        generation_config=GenerationConfig(response_mime_type="application/json",
                                           temperature=0.7, max_output_tokens=32768))
    u = response.usage_metadata
    output = u.candidates_token_count + (getattr(u, "thoughts_token_count", 0) or 0)
    spent.append(cost_usd(model._model_name.split("/")[-1], u.prompt_token_count, output))
    try:
        data = json.loads(response.text)
        for visit in data["visits"]:
            SoapNote.model_validate(visit["soap"])
        SoapNote.model_validate(data["today"])
    except (KeyError, TypeError, json.JSONDecodeError, ValidationError) as e:
        print(f"skipped {condition}: {type(e).__name__}")
        return None
    return {"id": f"p{index:02d}", "condition": condition, **data}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--model", default="gemini-3.1-pro-preview")
    ap.add_argument("--project", required=True)
    ap.add_argument("--location", default="global")
    args = ap.parse_args()

    import vertexai
    from vertexai.generative_models import GenerativeModel

    vertexai.init(project=args.project, location=args.location)
    model = GenerativeModel(args.model)
    conditions = CONDITIONS[: args.n]
    spent: list[float] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        cases = [c for c in pool.map(lambda ic: generate(model, ic[1], ic[0] + 1, spent),
                                     enumerate(conditions)) if c]
    CACHE.mkdir(exist_ok=True)
    (CACHE / "history_cases.json").write_text(json.dumps(cases, indent=1))
    print(f"{len(cases)}/{len(conditions)} patients -> {CACHE / 'history_cases.json'}"
          f" (${sum(spent):.2f})")


if __name__ == "__main__":
    main()
