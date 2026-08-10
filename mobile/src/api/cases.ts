// Clinical cases — group encounters for one complaint/episode under a patient.
const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export interface Case {
  org_id: string;
  clinic_id: string;
  patient_id: string;
  title: string;
  status: 'open' | 'closed';
  encounter_count: number;
  opened_at: string;
  last_encounter_at: string | null;
}

export interface CaseEntry {
  id: string;
  case: Case;
}

function headers(idToken: string): Record<string, string> {
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
      detail = ((await res.json()) as { detail?: string }).detail ?? null;
    } catch {
      /* not JSON */
    }
    throw new Error(detail ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listCases(idToken: string, patientId: string): Promise<CaseEntry[]> {
  const res = await fetch(`${BASE_URL}/patients/${encodeURIComponent(patientId)}/cases`, {
    headers: headers(idToken),
  });
  const body = await jsonOrThrow<{ cases: CaseEntry[] }>(res);
  return body.cases;
}
