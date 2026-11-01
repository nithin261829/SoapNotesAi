"""Offline checks for the eval scoring helpers (no model calls)."""
from __future__ import annotations

from eval.metrics import judge_scores, ungrounded_values, wer

DIALOGUE = """[doctor] your blood pressure today is 132 over 84 .
[patient] okay .
[doctor] and you weigh 180 pounds . keep taking lisinopril 20 mg once a day ."""


def test_wer_ignores_speaker_tags_and_punctuation():
    assert wer("[doctor] Hi, Andrew. How are you?", "hi andrew how are you") == 0.0


def test_wer_counts_one_substitution():
    assert wer("take two tablets daily", "take ten tablets daily") == 0.25


def test_spoken_vitals_and_unit_conversions_are_grounded():
    soap = {
        "objective": {"vitals": {"blood_pressure": "132/84", "weight_kg": 81.6}},
        "plan": {"medications": [{"name": "lisinopril", "dose": "20 mg"}]},
    }
    assert ungrounded_values(soap, DIALOGUE) == []


def test_invented_vital_and_dose_are_flagged():
    soap = {
        "objective": {"vitals": {"heart_rate_bpm": 72}},
        "subjective": {"current_medications": [{"name": "metformin", "dose": "500 mg"}]},
    }
    assert ungrounded_values(soap, DIALOGUE) == [
        "vitals.heart_rate_bpm = 72",
        "dose of metformin = 500 mg",
    ]


def test_judge_scores_counts_labels_and_coverage():
    verdict = {
        "claims": [{"label": "supported"}, {"label": "Unsupported"}, {"label": "contradicted"}],
        "reference_facts": [{"covered": True}, {"covered": False}],
    }
    assert judge_scores(verdict) == {
        "claims": 3, "unsupported": 1, "contradicted": 1,
        "reference_facts": 2, "facts_covered": 1,
    }


def test_gemini_api_answer_skips_thoughts_and_bills_thinking_tokens():
    from eval.gemini_api import answer

    body = {
        "candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": "planning...", "thought": True}, {"text": '{"ok": 1}'}]}}],
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20,
                          "thoughtsTokenCount": 30},
    }
    assert answer(body) == ('{"ok": 1}', 100, 50)


def test_numbers_said_as_words_are_grounded():
    dialogue = ("[doctor] it's about one seventy over , i'm sorry , one twenty over seventy . "
                "your temperature is ninety eight . one and your heart rate is seventy two . "
                "i'll prescribe clindamycin four hundred milligrams , and you said a hundred "
                "and eighty over eighty at home .")
    soap = {
        "objective": {"vitals": {"blood_pressure": "120/70", "temperature_c": 36.72,
                                 "heart_rate_bpm": 72}},
        "plan": {"medications": [{"name": "clindamycin", "dose": "400 mg"}]},
        "subjective": {"current_medications": []},
    }
    assert ungrounded_values(soap, dialogue) == []
    soap["objective"]["vitals"]["blood_pressure"] = "180/80 mmHg"
    assert ungrounded_values(soap, dialogue) == []
    soap["objective"]["vitals"]["heart_rate_bpm"] = 88
    soap["objective"]["vitals"]["pain_scale_0_10"] = 0
    assert ungrounded_values(soap, dialogue) == [
        "vitals.heart_rate_bpm = 88", "vitals.pain_scale_0_10 = 0"]
