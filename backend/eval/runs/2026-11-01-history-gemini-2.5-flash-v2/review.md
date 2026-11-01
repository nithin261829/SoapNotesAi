# Manual review: patient-history RAG, second run

Same 12 synthetic patients and expected facts as the first run
(`../2026-11-01-history-gemini-2.5-flash/`), after the retrieval and prompt
changes made from that run's review. All 72 statements and 52 expected facts
were read by hand; numbers and dates were also checked by script.

## Results

| | Run 1 | Run 2 |
|---|---|---|
| Expected facts stated with their values, by hand | 15/52 (29%) | **44/52 (85%)** |
| Expected facts stated with their values, LLM judge | 7/52 | 36/52 (69%) |
| Expected facts missing entirely, by hand | 12/52 | 6/52 |
| Statements with a wrong number, date or claim, by hand | 1 (misleading dose) | **0 of 72** |
| Chunks from another patient passed to the comparer | 0 | 0 |
| Statements citing the unrelated visit or report | 0 | 0 |
| Cost of the run | $0.29 judge | $0.47 judge (metered); comparer not metered, estimated under $0.10 |
| Median latency per follow-up | 10.4 s | 14.8 s |

Hand rule (same as run 1): **covered** = the same comparison with its key
values; a comparison against a different earlier visit counts, and a missing
secondary clause (e.g. "approaching the unaffected side's 45 kg") does not
make it partial. The judge marks those secondary omissions partial, which is
the whole gap between 36 and 44 (8 facts); both found the same 6 missing.

## Accuracy

- Every number and every date in the 72 statements appears in today's note or
  in a record the statement cites (script check, then read).
- The judge's one "unsupported" label is wrong: p04 "Initial imaging on
  2023-08-28 confirmed a Grade II ATFL sprain" matches the cited report
  ("IMPRESSION: 2. Grade II ATFL sprain", dated 2023-08-28).
- The run-1 misleading medication statement is fixed: p12 now says the
  patient "is no longer noted to be taking Ibuprofen", then gives the earlier
  doses as history.

## What is still missing

- **Report findings (4 of the 6 missing facts):** p02 lumbar X-ray, p03
  shoulder ultrasound, p08 plantar fascia ultrasound, p10 hip X-ray. The report
  reached the comparer every time; the comparer used it for 6 of 12 patients.
- **Exercise program (1):** p03 pendulums → wall walks → bands not stated.
- **Squat (1):** p01 "pain at 60 degrees of flexion → full depth" not stated.

## Defects found by reading, not by the metrics

- **Record IDs in the text:** 12 of 72 statements had chunk IDs such as
  `[note-p05-v1-objective]` written into the sentence. Fixed in code after
  this run (`_INLINE_IDS` in `patient_history.py`); the cleaned run-2 output has
  none. The prompt was left unchanged so these numbers still describe it.
- **Length:** median 40 words, longest 90. Accurate but slow to scan in the
  app. Shortening them is a prompt change that needs its own run, to check the
  values are not lost again.

## Limits

- Patients, today's notes and expected facts are written by Gemini 3.1 Pro,
  not taken from real charts.
- With 3 earlier visits and 2 reports per patient, every record reaches the
  comparer, so this measures the comparer's selection and grounding, not
  retrieval ranking over a long history.
