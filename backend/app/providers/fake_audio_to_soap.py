"""Canned `AudioToSoap` implementation for tests + zero-cost dev iteration.

Set `AUDIO_TO_SOAP_PROVIDER=fake` in `backend/.env` to use this in place of the
real Vertex AI provider — handy when iterating on the rest of the pipeline
without burning Gemini calls.

The canned response is intentionally generic so you can see the whole UI flow
without confusing it for a real clinical transcription.
"""
from __future__ import annotations

from datetime import date

from app.interfaces.audio_to_soap import AudioToSoap, AudioToSoapResult
from app.models.soap import (
    Allergy,
    Assessment,
    Medication,
    Objective,
    PatientMeta,
    Plan,
    SoapNote,
    Subjective,
    Vitals,
)

_CANNED_TRANSCRIPT = (
    "[FAKE PROVIDER — canned response for cost-free dev iteration. "
    "Set AUDIO_TO_SOAP_PROVIDER=vertex_gemini in backend/.env to use real Gemini.]\n\n"
    "Patient is a 45-year-old female presenting with a chief complaint of cough for three days. "
    "The cough is productive with yellow sputum and is worse at night. "
    "She denies fever, chest pain, or shortness of breath. "
    "Past medical history is significant for hypertension, well controlled on lisinopril 10 milligrams daily. "
    "No known drug allergies. "
    "Vitals today: blood pressure 128 over 82, heart rate 78, respiratory rate 16, "
    "temperature 36.8 Celsius, oxygen saturation 98 percent on room air. "
    "On exam, scattered rhonchi bilaterally with good air movement. No wheezes, no rales. "
    "Assessment: acute bronchitis, likely viral. "
    "Plan: supportive care with rest and hydration. "
    "Dextromethorphan 30 milligrams as needed at bedtime. "
    "Return if symptoms worsen or persist beyond two weeks."
)


class FakeAudioToSoap:
    PROVIDER_NAME = "fake"
    MODEL_VERSION = "canned-bronchitis-v1"

    def process(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        encounter_date_iso: str,
    ) -> AudioToSoapResult:
        # We don't read audio_bytes — they're discarded — but we accept them
        # so the call signature matches the real provider for swap-in testing.
        _ = (audio_bytes, mime_type)

        encounter_date = date.fromisoformat(encounter_date_iso[:10])

        soap = SoapNote(
            patient=PatientMeta(
                name="Test Patient",
                age=45,
                sex="female",
                encounter_date=encounter_date,
            ),
            subjective=Subjective(
                chief_complaint="Cough for three days",
                history_present_illness=(
                    "Productive cough with yellow sputum, worse at night. "
                    "Denies fever, chest pain, or shortness of breath."
                ),
                symptoms=["productive cough", "yellow sputum", "worse at night"],
                relevant_history="Hypertension, well controlled",
                current_medications=[
                    Medication(name="Lisinopril", dose="10 mg", frequency="daily"),
                ],
                allergies=[Allergy(substance="NKDA")],
            ),
            objective=Objective(
                vitals=Vitals(
                    blood_pressure="128/82",
                    heart_rate_bpm=78,
                    respiratory_rate=16,
                    temperature_c=36.8,
                    spo2_percent=98,
                ),
                findings=[
                    "Scattered rhonchi bilaterally with good air movement",
                    "No wheezes",
                    "No rales",
                ],
            ),
            assessment=Assessment(
                impressions=["Acute bronchitis, likely viral"],
                diagnoses=["Acute bronchitis"],
            ),
            plan=Plan(
                medications=[
                    Medication(
                        name="Dextromethorphan",
                        dose="30 mg",
                        frequency="PRN at bedtime",
                    ),
                ],
                follow_up="Return in 2 weeks or if symptoms worsen",
                patient_education="Rest and hydration",
            ),
            llm_provider=self.PROVIDER_NAME,
            llm_model_version=self.MODEL_VERSION,
        )

        return AudioToSoapResult(
            transcript=_CANNED_TRANSCRIPT,
            soap=soap,
            provider=self.PROVIDER_NAME,
            model_version=self.MODEL_VERSION,
        )
