// Typed REST client for the FastAPI backend.
// Concrete endpoints are added in later build steps; this file just establishes
// the base URL + auth-header pattern so callers have one place to import from.

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export interface RequestOptions {
  idToken?: string;
  signal?: AbortSignal;
}

export async function apiFetch(path: string, init: RequestInit & RequestOptions = {}) {
  const { idToken, signal, headers, ...rest } = init;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    signal,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) {
    // Surface a code/step shape; never assume the body contains PHI.
    const body = await res.text();
    throw new Error(`API ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res;
}

export async function getHealth(): Promise<{ status: string }> {
  const res = await apiFetch('/health');
  return res.json();
}
