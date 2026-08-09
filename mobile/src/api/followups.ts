// Follow-up scheduling API. Reminder pushes are sent server-side (Standard/
// Premium tiers) by a daily Cloud Scheduler job.

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export type FollowupStatus = 'scheduled' | 'done' | 'cancelled';

export interface Followup {
  org_id: string;
  clinic_id: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string | null;
  recording_id: string | null;
  due_date: string; // YYYY-MM-DD
  note: string | null;
  status: FollowupStatus;
  created_at: string;
}

export interface FollowupEntry {
  id: string;
  followup: Followup;
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

export async function listFollowups(
  idToken: string,
  patientId?: string,
): Promise<FollowupEntry[]> {
  const qs = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : '';
  const res = await fetch(`${BASE_URL}/followups${qs}`, { headers: headers(idToken) });
  const body = await jsonOrThrow<{ followups: FollowupEntry[] }>(res);
  return body.followups;
}

export async function createFollowup(
  idToken: string,
  params: { patient_id: string; due_date: string; note?: string; recording_id?: string },
): Promise<FollowupEntry> {
  const res = await fetch(`${BASE_URL}/followups`, {
    method: 'POST',
    headers: headers(idToken),
    body: JSON.stringify(params),
  });
  return jsonOrThrow<FollowupEntry>(res);
}

export async function patchFollowup(
  idToken: string,
  id: string,
  params: { due_date?: string; note?: string; status?: FollowupStatus },
): Promise<FollowupEntry> {
  const res = await fetch(`${BASE_URL}/followups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers(idToken),
    body: JSON.stringify(params),
  });
  return jsonOrThrow<FollowupEntry>(res);
}

/** Register this device's push token for follow-up reminder notifications. */
export async function registerPushToken(
  idToken: string,
  token: string,
  tokenType: 'expo' | 'fcm' = 'expo',
): Promise<void> {
  const res = await fetch(`${BASE_URL}/accounts/push-token`, {
    method: 'POST',
    headers: headers(idToken),
    body: JSON.stringify({ token, token_type: tokenType }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`push_token_failed_${res.status}`);
  }
}
