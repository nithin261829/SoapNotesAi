# Audio → SOAP eval: gemini-2.5-flash

20 ACI-Bench visits (test set 1, CC BY 4.0), voiced with macOS TTS, average 3.9 min of audio. Backend: vertex. Judge: gemini-3.1-pro-preview (19 visits judged). Run 2026-11-01.

| Metric | Result |
|---|---|
| Notes generated and schema-valid | 19/20 |
| Transcript word error rate (mean) | 5.0% |
| Reference facts captured | 404/436 (92.7%) |
| Note claims not supported by the visit | 6/658 (0.9%) |
| Note claims contradicting the visit | 6/658 (0.9%) |
| Vitals/doses whose numbers were never said | 1 |
| Latency p50 / p95 | 16.8 s / 21.7 s |
| Generation cost per note at list price (mean) | $0.0120 |

Failures: D2N098 (schema_validation_failed)

Numbers in notes that were never said:
- D2N110: vitals.pain_scale_0_10 = 0

Caveats: synthetic TTS audio is cleaner than a real clinic; English only (the app also handles Hindi, Telugu and Kannada); the judge is an LLM and its labels were spot-checked, not fully audited.
