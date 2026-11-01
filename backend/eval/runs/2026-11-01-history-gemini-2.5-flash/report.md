# Patient-history RAG eval: gemini-2.5-flash

12 synthetic physiotherapy patients (gemini-3.1-pro-preview-written), each with 2 earlier visits, 1 unrelated visit, 1 relevant and 1 unrelated scanned report. Embeddings: text-embedding-005; top 6 chunks; judge: gemini-3.1-pro-preview. Run 2026-11-01.

| Metric | Result |
|---|---|
| Records needed by expected facts that were retrieved | 28/34 (82.4%) |
| Expected facts the interval history states | 7/52 (13.5%) |
| Statements supported by their citations | 59/60 (98.3%) |
| Statements unsupported / contradicted | 1 / 0 |
| Statements citing the unrelated visit or report | 0 |
| Retrieved chunks from the unrelated visit or report | 1/72 (1.4%) |
| Retrieved chunks from another patient | 0 |
| Statements dropped by the citation guardrail | 0 |
| Latency per follow-up (median) | 10.4 s |

Caveats: patients and expected facts are LLM-written; the judge is an LLM and its labels should be spot-checked.
