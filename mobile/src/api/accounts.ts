// Account-provisioning API client.
//
// Every call carries the Firebase ID token. After a /signup/* or /clinic-switch
// call, the caller MUST force-refresh the local Firebase user via
// `user.getIdToken(true)` so the new custom claims (org_id, active_clinic_id,
// role) propagate into subsequent requests.

// All app-versioned routes hang off /v1. Pin here so we can ship /v2 alongside
// without breaking old APKs.
const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export type ClinicRole = 'owner' | 'admin' | 'doctor' | 'viewer';

export interface ClinicMembership {
  clinic_id: string;
  role: ClinicRole;
  joined_at: string;
}

export interface UserProfile {
  email: string;
  display_name: string | null;
  credentials: string | null;
  org_id: string;
  default_clinic_id: string | null;
  memberships: ClinicMembership[];
  created_at: string;
  updated_at: string;
}

export interface MeResponse {
  profile: UserProfile;
  org_name: string | null;
  active_clinic_name: string | null;
}

export class AccountsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'AccountsError';
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? null;
    } catch {
      /* body wasn't JSON */
    }
    throw new AccountsError(`http_${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

function authHeaders(idToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    Authorization: `Bearer ${idToken}`,
  };
}

export async function getMe(idToken: string): Promise<MeResponse | null> {
  const res = await fetch(`${BASE_URL}/accounts/me`, { headers: authHeaders(idToken) });
  if (res.status === 404) return null; // user not provisioned yet
  return jsonOrThrow<MeResponse>(res);
}

export interface SignupOrgParams {
  orgName: string;
  clinicName: string;
  displayName?: string;
  credentials?: string;
}

export async function signupOrg(idToken: string, params: SignupOrgParams): Promise<UserProfile> {
  const res = await fetch(`${BASE_URL}/accounts/signup/org`, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify({
      org_name: params.orgName,
      clinic_name: params.clinicName,
      display_name: params.displayName ?? null,
      credentials: params.credentials ?? null,
    }),
  });
  return jsonOrThrow<UserProfile>(res);
}

export interface SignupInviteParams {
  code: string;
  displayName?: string;
  credentials?: string;
}

export async function signupInvite(
  idToken: string,
  params: SignupInviteParams,
): Promise<UserProfile> {
  const res = await fetch(
    `${BASE_URL}/accounts/signup/invite/${encodeURIComponent(params.code)}`,
    {
      method: 'POST',
      headers: authHeaders(idToken),
      body: JSON.stringify({
        display_name: params.displayName ?? null,
        credentials: params.credentials ?? null,
      }),
    },
  );
  return jsonOrThrow<UserProfile>(res);
}

export async function switchClinic(idToken: string, clinicId: string): Promise<MeResponse> {
  const res = await fetch(`${BASE_URL}/accounts/clinic-switch`, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify({ clinic_id: clinicId }),
  });
  return jsonOrThrow<MeResponse>(res);
}
