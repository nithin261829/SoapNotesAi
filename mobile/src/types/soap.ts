// Mirror of backend/app/models/soap.py. Keep in sync.
// Field absence is rendered as "not documented" in the PDF — the LLM must not fabricate.

export type Sex = 'male' | 'female' | 'other' | 'unknown';

export interface Medication {
  name: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  notes?: string | null;
}

export interface Vitals {
  blood_pressure?: string | null;
  heart_rate_bpm?: number | null;
  respiratory_rate?: number | null;
  temperature_c?: number | null;
  spo2_percent?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  pain_scale_0_10?: number | null;
}

export interface Allergy {
  substance: string;
  reaction?: string | null;
  severity?: 'mild' | 'moderate' | 'severe' | 'unknown' | null;
}

export interface PatientMeta {
  name: string;
  age?: number | null;
  sex?: Sex | null;
  encounter_date: string; // ISO date
}

export interface Subjective {
  chief_complaint?: string | null;
  history_present_illness?: string | null;
  symptoms: string[];
  relevant_history?: string | null;
  current_medications: Medication[];
  allergies: Allergy[];
}

export interface Objective {
  vitals: Vitals;
  physical_exam?: string | null;
  findings: string[];
  labs_reviewed: string[];
}

export interface Assessment {
  impressions: string[];
  diagnoses: string[];
}

export interface Plan {
  medications: Medication[];
  tests_ordered: string[];
  procedures: string[];
  follow_up?: string | null;
  patient_education?: string | null;
  referrals: string[];
}

export interface SoapNote {
  patient: PatientMeta;
  subjective: Subjective;
  objective: Objective;
  assessment: Assessment;
  plan: Plan;

  source_transcript_id?: string | null;
  llm_provider?: string | null;
  llm_model_version?: string | null;
  validated: boolean;
  edited_by_doctor: boolean;

  pdf_storage_path?: string | null;
  signed_at?: string | null;
  signed_by_uid?: string | null;

  created_at: string;
  updated_at: string;
}
