# Audio → SOAP eval

Measures the production provider (`app/providers/vertex_gemini.py`) on doctor-patient
visits with clinician-written reference notes.

**Data:** [ACI-Bench](https://github.com/wyim/aci-bench) test set 1 (Yim et al., 2023,
CC BY 4.0). ACI-Bench has no audio, so `prepare.py` voices each dialogue with macOS
`say` (Indian English voice for the doctor, US English for the patient) and joins the
turns into one 16 kHz AAC file, the same format the mobile app uploads.

**What is scored**

| Check | How | Needs a model |
|---|---|---|
| Notes generated and schema-valid | provider raised no `AudioToSoapError` | no |
| Transcript word error rate | word-level edit distance against the source dialogue | no |
| Numbers never said | every vital and dose number must appear in the visit (or be its kg/cm/°C conversion) | no |
| Reference facts captured | judge lists up to 25 key facts in the reference note, marks each covered or not | yes |
| Unsupported / contradicted claims | judge splits the generated note into atomic claims and labels each against the visit | yes |
| Latency, cost per note | wall time of `process()`; tokens × Vertex list price (audio billed at the audio rate) | no |

**Run** (from `backend/`):

```bash
uv run python -m eval.prepare --n 20                          # free: download + TTS, ~10 min
uv run python -m eval.run_eval --limit 20 --backend vertex      # production code path; needs Vertex billing
uv run python -m eval.run_eval --limit 20 --backend gemini-api  # same prompt via an AI Studio key
```

`--backend vertex` calls `VertexGeminiAudioToSoap` itself (needs `gcloud auth
application-default login` and the `VERTEX_*` settings). `--backend gemini-api` sends the
same prompt, model and generation settings through the Gemini API using `GEMINI_API_KEY`
(environment or `backend/.env`), and validates the output with the same `SoapNote` schema.
Costs are reported at Vertex list price, including thinking tokens, even on the free tier.

Results land in `eval/runs/<date>-<model>-<backend>-judge-<judge>/`; `--judge-only` re-scores the notes from an earlier run with another judge, without regenerating them (`report.md`, `scores.csv`). Raw transcripts,
notes and judge verdicts stay in `eval/.cache/` (gitignored).

**Limits:** TTS audio is cleaner than a real clinic, the set is English only, and the
judge is an LLM (`gemini-2.5-pro` by default; pass `--judge`), so its labels should be spot-checked.

## Patient-history RAG eval

Scores `app/services/patient_history.py`, which adds a cited interval history to
follow-up notes from the patient's earlier notes and uploaded documents.

ACI-Bench has one visit per patient, so `history_cases.py` has an LLM write
synthetic physiotherapy patients: two earlier visits for the main problem, one
unrelated visit, a relevant scanned report, an unrelated report, today's
follow-up, and the facts a good interval history should state (with the records
each fact needs). Every note is validated against `SoapNote`.

```bash
uv run python -m eval.history_cases --n 12 --project <vertex project>   # ~$0.03 per patient
uv run python -m eval.history_eval --project <vertex project>          # embeddings + comparer + judge
```

All patients go into one shared store, so the run also checks that no chunk from
another patient is ever retrieved. Reported: retrieval recall of the needed
records, expected facts covered, statements supported by their citations,
citations of the unrelated records, and statements the citation guardrail dropped.
