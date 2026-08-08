"""Smoke tests for the SOAP Pydantic schema.

These do NOT exercise any external service. They verify:
  - an empty SOAP note is valid (LLM may legitimately return mostly-empty results),
  - clinical lists default to [],
  - the schema serializes to a Firestore-friendly dict.
"""
from datetime import date

from app.models.soap import PatientMeta, SoapNote


def test_empty_soap_note_is_valid() -> None:
    note = SoapNote(
        patient=PatientMeta(name="Jane Doe", encounter_date=date(2026, 1, 1)),
    )
    assert note.subjective.symptoms == []
    assert note.objective.vitals.blood_pressure is None
    assert note.assessment.diagnoses == []
    assert note.plan.medications == []
    assert note.validated is True
    assert note.signed_at is None


def test_soap_note_roundtrips_to_dict() -> None:
    note = SoapNote(
        patient=PatientMeta(name="Jane Doe", encounter_date=date(2026, 1, 1)),
    )
    data = note.model_dump(mode="json")
    rebuilt = SoapNote.model_validate(data)
    assert rebuilt == note
