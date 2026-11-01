# Manual review: patient-history RAG, first run

All 60 statements and 52 expected facts were read by hand against the
records each statement cites and today's note.

## Expected-fact coverage: judge vs hand

Hand labels: **covered** = the same comparison with its key values (a
comparison against a different earlier visit counts, e.g. "1/10, down from
4/10 at the last visit" for a fact written against the first visit);
**partial** = the right comparison without the values, or only part of a
compound fact; **missing** = not stated.

| Patient | Judge covered | Hand covered | Hand partial | Hand missing |
|---|---|---|---|---|
| p01 knee PFPS | 0/4 | 0 | 3 | 1 |
| p02 low back | 4/5 | 4 | 0 | 1 |
| p03 frozen shoulder | 1/4 | 2 | 1 | 1 |
| p04 ankle sprain | 0/4 | 0 | 4 | 0 |
| p05 tennis elbow | 0/4 | 1 | 2 | 1 |
| p06 neck | 1/5 | 1 | 3 | 1 |
| p07 ACL | 0/4 | 2 | 1 | 1 |
| p08 plantar fasciitis | 0/4 | 0 | 2 | 2 |
| p09 rotator cuff | 0/4 | 0 | 3 | 1 |
| p10 hip OA | 1/5 | 2 | 2 | 1 |
| p11 carpal tunnel | 0/4 | 2 | 1 | 1 |
| p12 sciatica | 0/5 | 1 | 3 | 1 |
| **Total** | **7/52** | **15/52 (29%)** | **25/52** | **12/52** |

The judge missed clear matches (p05 "pain 7/10 to 2/10", p11 "grip 60 lbs
from 52 lbs", p07 "flexion 110 to 130 degrees") because expected facts bundle
several details and name the first visit as baseline. The hand count is the
one to quote; the judge prompt needs a partial level and should accept a
different baseline visit.

## Why facts were missed or only partial

1. **Values left out although they were in front of the comparer (most of
   the 25 partials).** p04 had "Dorsiflexion 0 deg" in the retrieved first-visit
   chunk and "18 deg" in today's note, yet wrote "range of motion is nearly
   full, showing continued improvement from restricted motion". Same pattern
   for p01 hip strength, p06 cervical motion, p09 shoulder motion. Prompt issue.
2. **Plan sections never retrieved (5 exercise-progression facts: p01, p03,
   p05, p08, p09).** The query is today's subjective + assessment, so the top 6
   chunks were subjective/assessment/objective sections; home-exercise
   progressions live in the plan section. Retrieval issue.
3. **Scanned reports missed or unused (11 of 12 report-based facts).** The
   relevant report was not in the top 6 chunks for p01, p02, p04, p06, p09 and
   p10; when it was retrieved (p05, p07, p08, p11, p12) the comparer did not use
   it. Note sections from the same complaint always outrank a report written in
   a different style. Retrieval and prompt issue.

## Accuracy of the statements

- Judge: 59/60 supported, 1 unsupported (p09).
- By hand, one statement the judge passed is **misleading**: p12 "has reduced
  Ibuprofen use from 600mg three times a day to 400mg once a day". Both doses
  are in the records, but today's note lists no medications, so read as
  current status it is wrong. The comparer needs a rule that current status
  comes only from today's note.
- No statement cited the unrelated visit or report; no chunk from another
  patient was retrieved; the citation guardrail had nothing to drop.

## Changes made after this review

- Retrieval: rank note sections, then pass the top 3 earlier visits **in
  full** (all four sections) plus the top 2 report parts from a separate
  document search, so plans and reports are not crowded out.
- Comparer prompt: give values on both sides, compare with the first and the
  latest visit, use report findings, and take current status only from today.
- Judge prompt: covered / partial / missing, any baseline visit accepted, and a
  "misleading" label for earlier values presented as current.
