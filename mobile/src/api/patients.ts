import type { SoapNote } from '@/types/soap';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export type PatientSex = 'male' | 'female' | 'other' | 'unknown';

export interface Patient {
  org_id: string;
  clinic_id: string;
  name: string;
  date_of_birth: string | null;
  age_at_record: number | null;
  age_recorded_at: string | null;
  sex: PatientSex | null;
  created_by_uid: string;
  created_at: string;
  updated_at: string;
  last_encounter_at: string | null;
  recording_count: number;
}

export interface PatientEntry {
  id: string;
  patient: Patient;
}

export interface TranscriptDoc {
  text: string;
  language: string;
  words: unknown[];
}

export interface Recording {
  org_id: string;
  clinic_id: string;
  patient_id: string;
  audio_storage_path: string;
  mime_type: string;
  duration_seconds: number | null;
  size_bytes: number | null;
  created_by_uid: string;
  created_at: string;
  updated_at: string;
  status: string;
  transcript: TranscriptDoc | null;
  soap: SoapNote | null;
  ai_provider: string | null;
  ai_model_version: string | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
}

export interface RecordingEntry {
  id: string;
  recording: Recording;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function authHeaders(idToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    Authorization: `Bearer ${idToken}`,
  };
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? null;
    } catch {
      /* not JSON */
    }
    throw new ApiError(`http_${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

export async function listPatients(idToken: string): Promise<PatientEntry[]> {
  const res = await fetch(`${BASE_URL}/patients`, { headers: authHeaders(idToken) });
  const body = await jsonOrThrow<{ patients: PatientEntry[] }>(res);
  return body.patients;
}

export interface CreatePatientParams {
  name: string;
  date_of_birth?: string;
  age_at_record?: number;
  sex?: PatientSex;
}

export async function createPatient(
  idToken: string,
  params: CreatePatientParams,
): Promise<PatientEntry> {
  const res = await fetch(`${BASE_URL}/patients`, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify(params),
  });
  return jsonOrThrow<PatientEntry>(res);
}

export async function getPatient(idToken: string, id: string): Promise<PatientEntry> {
  const res = await fetch(`${BASE_URL}/patients/${encodeURIComponent(id)}`, {
    headers: authHeaders(idToken),
  });
  return jsonOrThrow<PatientEntry>(res);
}

export interface PatchPatientParams {
  name?: string;
  age_at_record?: number;
  sex?: PatientSex;
}

export async function patchPatient(
  idToken: string,
  id: string,
  params: PatchPatientParams,
): Promise<PatientEntry> {
  const res = await fetch(`${BASE_URL}/patients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(idToken),
    body: JSON.stringify(params),
  });
  return jsonOrThrow<PatientEntry>(res);
}

export async function listRecordings(
  idToken: string,
  patientId: string,
): Promise<RecordingEntry[]> {
  const res = await fetch(
    `${BASE_URL}/recordings?patient_id=${encodeURIComponent(patientId)}`,
    { headers: authHeaders(idToken) },
  );
  const body = await jsonOrThrow<{ recordings: RecordingEntry[] }>(res);
  return body.recordings;
}

export async function getRecording(
  idToken: string,
  id: string,
  patientId: string,
): Promise<RecordingEntry> {
  const url = `${BASE_URL}/recordings/${encodeURIComponent(id)}?patient_id=${encodeURIComponent(patientId)}`;
  const res = await fetch(url, { headers: authHeaders(idToken) });
  return jsonOrThrow<RecordingEntry>(res);
}

export async function patchRecordingSoap(
  idToken: string,
  id: string,
  patientId: string,
  soap: SoapNote,
): Promise<RecordingEntry> {
  const url = `${BASE_URL}/recordings/${encodeURIComponent(id)}?patient_id=${encodeURIComponent(patientId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(idToken),
    body: JSON.stringify({ soap }),
  });
  return jsonOrThrow<RecordingEntry>(res);
}
