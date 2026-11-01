# Patient-history RAG eval: gemini-2.5-flash

12 synthetic physiotherapy patients (gemini-3.1-pro-preview-written), each with 2 earlier visits, 1 unrelated visit, 1 relevant and 1 unrelated scanned report. Embeddings: text-embedding-005; up to 3 earlier visits in full + 2 report parts; judge: gemini-3.1-pro-preview. Run 2026-11-01.

| Metric | Result |
|---|---|
| Records needed by expected facts that reached the comparer | 34/34 (100.0%) |
| Expected facts stated with their values | 36/52 (69.2%) |
| Expected facts stated, values missing or only in part | 10/52 (19.2%) |
| Statements supported by their citations | 71/72 (98.6%) |
| Statements unsupported / contradicted / misleading | 1 / 0 / 0 |
| Statements citing the unrelated visit or report | 0 |
| Unrelated visit or report passed to the comparer | 24/24 (100.0%) |
| Chunks from another patient passed to the comparer | 0 |
| Statements dropped by the citation guardrail | 0 |
| Latency per follow-up (median) | 14.8 s |

Caveats: patients and expected facts are LLM-written; the judge is an LLM and its labels should be spot-checked. With only 3 earlier visits and 2 reports per patient, the visit and report caps exclude little, so this mostly tests the comparer, not retrieval ranking.
