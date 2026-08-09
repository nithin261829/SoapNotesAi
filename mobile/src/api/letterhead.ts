// Clinic letterhead API: fetch current letterhead + owner-only updates.
// Logo uploads go as multipart/form-data via the same createUploadTask
// pattern used for verification proofs (src/api/verification.ts).

import * as FileSystem from 'expo-file-system/legacy';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export interface LetterheadFields {
  name: string | null;
  address_lines: string[];
  phone: string | null;
  email: string | null;
  tagline: string | null;
  logo_storage_path: string | null;
}

export interface LetterheadResponse {
  letterhead: LetterheadFields;
  has_logo: boolean;
  change_count: number;
  next_change_fee_paise: number;
}

export class LetterheadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'LetterheadError';
  }
}

function authHeaders(idToken: string): Record<string, string> {
  return {
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
    throw new LetterheadError(`http_${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

export async function getLetterhead(idToken: string): Promise<LetterheadResponse> {
  const res = await fetch(`${BASE_URL}/clinics/letterhead`, { headers: authHeaders(idToken) });
  return jsonOrThrow<LetterheadResponse>(res);
}

export interface UpdateLetterheadParams {
  name?: string;
  /** Newline-separated address lines. */
  address?: string;
  phone?: string;
  email?: string;
  tagline?: string;
  logoUri?: string;
  logoMimeType?: string;
}

/** Collect only the text fields the caller actually provided. */
function textFields(params: UpdateLetterheadParams): Record<string, string> {
  const fields: Record<string, string> = {};
  if (params.name !== undefined) fields.name = params.name;
  if (params.address !== undefined) fields.address = params.address;
  if (params.phone !== undefined) fields.phone = params.phone;
  if (params.email !== undefined) fields.email = params.email;
  if (params.tagline !== undefined) fields.tagline = params.tagline;
  return fields;
}

export async function updateLetterhead(
  idToken: string,
  params: UpdateLetterheadParams,
): Promise<LetterheadResponse> {
  const fields = textFields(params);

  if (params.logoUri) {
    // Logo present: multipart upload with the file as field 'logo'.
    const task = FileSystem.createUploadTask(`${BASE_URL}/clinics/letterhead`, params.logoUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'logo',
      mimeType: params.logoMimeType ?? 'image/png',
      parameters: fields,
      headers: authHeaders(idToken),
    });

    const result = await task.uploadAsync();
    if (!result) {
      throw new LetterheadError('no_result', null, null);
    }
    if (result.status >= 400) {
      let code: string | null = null;
      try {
        const parsed = JSON.parse(result.body) as { detail?: string };
        code = parsed.detail ?? null;
      } catch {
        /* body wasn't JSON */
      }
      throw new LetterheadError(`update_failed_${result.status}`, result.status, code);
    }
    try {
      return JSON.parse(result.body) as LetterheadResponse;
    } catch {
      throw new LetterheadError('invalid_response_body', result.status, null);
    }
  }

  // No logo: text-only multipart via FormData (React Native fetch handles this fine).
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  const res = await fetch(`${BASE_URL}/clinics/letterhead`, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: form,
  });
  return jsonOrThrow<LetterheadResponse>(res);
}
