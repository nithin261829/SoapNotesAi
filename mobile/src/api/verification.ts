// Doctor-verification API: status check + proof-document submission.
// The proof file is uploaded as multipart/form-data via the same
// createUploadTask pattern used for audio uploads (src/api/recordings.ts).

import * as FileSystem from 'expo-file-system/legacy';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export type VerificationStatusValue = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface VerificationStatus {
  status: VerificationStatusValue;
  medical_council: string | null;
  registration_number: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
}

export class VerificationError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'VerificationError';
  }
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
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? null;
    } catch {
      /* not JSON */
    }
    throw new VerificationError(`http_${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

export async function getVerificationStatus(idToken: string): Promise<VerificationStatus> {
  const res = await fetch(`${BASE_URL}/verification/status`, { headers: headers(idToken) });
  return jsonOrThrow<VerificationStatus>(res);
}

export interface SubmitVerificationParams {
  medicalCouncil: string;
  registrationNumber: string;
  fileUri: string;
  mimeType: string;
}

export async function submitVerification(
  idToken: string,
  params: SubmitVerificationParams,
): Promise<VerificationStatus> {
  const task = FileSystem.createUploadTask(`${BASE_URL}/verification/submit`, params.fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'proof',
    mimeType: params.mimeType,
    parameters: {
      medical_council: params.medicalCouncil,
      registration_number: params.registrationNumber,
    },
    headers: {
      'ngrok-skip-browser-warning': 'true',
      Authorization: `Bearer ${idToken}`,
    },
  });

  const result = await task.uploadAsync();
  if (!result) {
    throw new VerificationError('no_result', null, null);
  }
  if (result.status >= 400) {
    let code: string | null = null;
    try {
      const parsed = JSON.parse(result.body) as { detail?: string };
      code = parsed.detail ?? null;
    } catch {
      /* body wasn't JSON */
    }
    throw new VerificationError(`submit_failed_${result.status}`, result.status, code);
  }
  try {
    return JSON.parse(result.body) as VerificationStatus;
  } catch {
    throw new VerificationError('invalid_response_body', result.status, null);
  }
}
