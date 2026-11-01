# Manual review of the 2026-11-01 production run

Every claim the judge flagged and every number the checker flagged was read against the
source conversation by hand. Model: `gemini-2.5-flash` through `VertexGeminiAudioToSoap`.

## Judge flags (12 of 658 claims)

**Real errors (8)**

| Visit | Note said | Conversation said | Failure type |
|---|---|---|---|
| D2N091 | General: appears well | no general appearance stated | normal exam finding filled in |
| D2N091 | Heart: regular rate and rhythm, no murmurs | no heart exam stated | normal exam finding filled in |
| D2N113 | Abdomen: no tenderness | soft, no hepatosplenomegaly; tenderness not mentioned | normal exam finding filled in |
| D2N102 | Levothyroxine 10 mg | "alavert 10 milligrams" (transcribed as "a lev 10 milligrams") | misheard drug turned into a different real drug |
| D2N111 | Visits the trampoline park often | "I don't, and I think that's the issue" | negation flipped |
| D2N100 | Patient is 19 | age never said (7th grader) | demographic invented |
| D2N095 | Walks 20–60 minutes daily | "30 minutes to an hour" | number changed |
| D2N106 | Advised to consider avoiding cats | cat discussed, no such advice given | advice added |

**Judge errors (2):** D2N100 encounter date (the app supplies it, not the audio);
D2N111 "return to discuss results" (the doctor said "when you come back we can have that
discussion").

**Ambiguous (2):** D2N103 "8/3/2020" written as March 8 (day-first, which the prompt's
Indian conventions favour; the US reading is August 3); D2N106 symptom onset tied to the
move "about two years ago" in a garbled exchange.

## Number checker (vitals and doses)

One real flag: D2N110 recorded pain 0/10 when the patient only said "no, I can't feel it".
Ten earlier flags were checker bugs (numbers spoken as words, such as "one twenty over
seventy"), fixed in `metrics.spoken_numbers` and covered by tests. The model handled a
self-correction well: "one seventy over, I'm sorry, one twenty over seventy" became 120/70.

## Reference-fact recall

Some "missed" facts are not in the conversation at all: the reference notes include ages
taken from the chart (D2N111, D2N112), which the model correctly left blank, so 92.7% is a
lower bound.

## Schema failure (1 of 20)

D2N098 failed `SoapNote` validation because the model returned objects instead of strings
in `plan.procedures` and `plan.referrals`. In production that upload fails outright.

## What to fix first

1. Exam findings: forbid "normal" findings that were not dictated (3 of 8 errors).
2. Drug names: keep the heard name when unsure instead of mapping to a known drug.
3. Schema: accept `{name: ...}` objects for list-of-string fields, or coerce them.
