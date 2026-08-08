"""SOAP-note schema.

CRITICAL: every clinical field is optional and defaults to empty. The LLM
provider (see `app.interfaces.llm.SoapStructurer`) must extract only what is
present in the transcript — never invent vitals, diagnoses, dosages, or
findings. Absent fields are rendered as "not documented" in the PDF.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.common import FirestoreModel, utc_now

Sex = Literal["male", "female", "other", "unknown"]

# Lenient mapping for AI output. Defaults to "unknown" when we can't make sense
# of it rather than failing the entire upload over a stray "Female" / "M".
_SEX_ALIASES: dict[str, Sex] = {
    "m": "male", "male": "male", "man": "male", "boy": "male",
    "f": "female", "female": "female", "woman": "female", "girl": "female",
    "o": "other", "other": "other", "non-binary": "other", "nonbinary": "other",
    "nb": "other", "intersex": "other",
    "u": "unknown", "unknown": "unknown", "unspecified": "unknown",
    "not stated": "unknown", "not specified": "unknown", "n/a": "unknown",
}


def _coerce_sex(v: object) -> Optional[Sex]:
    if v is None:
        return None
    if isinstance(v, str):
        key = v.strip().lower()
        if not key:
            return None
        return _SEX_ALIASES.get(key, "unknown")
    return None


class Medication(FirestoreModel):
    name: str
    dose: Optional[str] = None
    route: Optional[str] = None          # e.g. "PO", "IV", "topical"
    frequency: Optional[str] = None      # e.g. "BID", "q6h", "once daily"
    duration: Optional[str] = None       # e.g. "7 days"
    notes: Optional[str] = None


class Vitals(FirestoreModel):
    blood_pressure: Optional[str] = None         # e.g. "128/82"
    heart_rate_bpm: Optional[int] = None
    respiratory_rate: Optional[int] = None
    temperature_c: Optional[float] = None
    spo2_percent: Optional[int] = None
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    pain_scale_0_10: Optional[int] = None


class Allergy(FirestoreModel):
    substance: str
    reaction: Optional[str] = None
    severity: Optional[Literal["mild", "moderate", "severe", "unknown"]] = None


class PatientMeta(FirestoreModel):
    """Patient-context block stored on the note itself (snapshot at encounter time)."""
    name: str = ""
    age: Optional[int] = None
    sex: Optional[Sex] = None
    encounter_date: date

    @field_validator("name", mode="before")
    @classmethod
    def _coerce_name(cls, v: object) -> str:
        # AI sometimes returns null when no name is mentioned in the audio.
        # Empty string lets the upload handler's timestamp-fallback path run.
        if v is None:
            return ""
        return str(v).strip()

    @field_validator("sex", mode="before")
    @classmethod
    def _validate_sex(cls, v: object) -> Optional[Sex]:
        return _coerce_sex(v)


class Subjective(FirestoreModel):
    chief_complaint: Optional[str] = None
    history_present_illness: Optional[str] = None
    symptoms: list[str] = Field(default_factory=list)
    relevant_history: Optional[str] = None         # PMH / social / family / ROS narrative
    current_medications: list[Medication] = Field(default_factory=list)
    allergies: list[Allergy] = Field(default_factory=list)


class Objective(FirestoreModel):
    vitals: Vitals = Field(default_factory=Vitals)
    physical_exam: Optional[str] = None
    findings: list[str] = Field(default_factory=list)
    labs_reviewed: list[str] = Field(default_factory=list)


class Assessment(FirestoreModel):
    impressions: list[str] = Field(default_factory=list)
    diagnoses: list[str] = Field(default_factory=list)


class Plan(FirestoreModel):
    medications: list[Medication] = Field(default_factory=list)
    tests_ordered: list[str] = Field(default_factory=list)
    procedures: list[str] = Field(default_factory=list)
    follow_up: Optional[str] = None
    patient_education: Optional[str] = None
    referrals: list[str] = Field(default_factory=list)


class SoapNote(FirestoreModel):
    """Located at clinics/{clinicId}/patients/{patientId}/recordings/{recordingId}/soap/{soapId}."""
    patient: PatientMeta
    subjective: Subjective = Field(default_factory=Subjective)
    objective: Objective = Field(default_factory=Objective)
    assessment: Assessment = Field(default_factory=Assessment)
    plan: Plan = Field(default_factory=Plan)

    # Provenance — never hidden from the doctor.
    source_transcript_id: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model_version: Optional[str] = None
    validated: bool = True
    edited_by_doctor: bool = False

    # Clinician sign-off. Null until the doctor explicitly signs.
    signed_at: Optional[datetime] = None
    signed_by_uid: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
