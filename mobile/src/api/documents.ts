// Patient-document API: list / upload / signed download URL / delete.
// Uploads go as multipart/form-data via the same createUploadTask pattern
// used for verification proofs (src/api/verification.ts).

import * as FileSystem from 'expo-file-system/legacy';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export interface PatientDocument {
  org_id: string;
  clinic_id: string;
  patient_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  label: string | null;
  uploaded_by_uid: string;
  created_at: string;
}

export interface DocumentEntry {
  id: string;
  document: PatientDocument;
}

export interface DocumentDownloadUrl {
  url: string;
  expires_in_seconds: number;
  filename: string;
  content_type: string;
}

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'DocumentError';
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
    throw new DocumentError(`http_${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

export async function listDocuments(idToken: string, patientId: string): Promise<DocumentEntry[]> {
  const res = await fetch(`${BASE_URL}/patients/${patientId}/documents`, {
    headers: headers(idToken),
  });
  const body = await jsonOrThrow<{ documents: DocumentEntry[] }>(res);
  return body.documents;
}

export interface UploadDocumentParams {
  patientId: string;
  fileUri: string;
  mimeType: string;
  filename: string;
  label?: string;
}

export async function uploadDocument(
  idToken: string,
  params: UploadDocumentParams,
): Promise<DocumentEntry> {
  const formParams: Record<string, string> = {};
  if (params.label && params.label.trim().length > 0) {
    formParams.label = params.label.trim();
  }
  const task = FileSystem.createUploadTask(
    `${BASE_URL}/patients/${params.patientId}/documents`,
    params.fileUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: params.mimeType,
      parameters: formParams,
      headers: {
        'ngrok-skip-browser-warning': 'true',
        Authorization: `Bearer ${idToken}`,
      },
    },
  );

  const result = await task.uploadAsync();
  if (!result) {
    throw new DocumentError('no_result', null, null);
  }
  if (result.status >= 400) {
    let code: string | null = null;
    try {
      const parsed = JSON.parse(result.body) as { detail?: string };
      code = parsed.detail ?? null;
    } catch {
      /* body wasn't JSON */
    }
    throw new DocumentError(`upload_failed_${result.status}`, result.status, code);
  }
  try {
    return JSON.parse(result.body) as DocumentEntry;
  } catch {
    throw new DocumentError('invalid_response_body', result.status, null);
  }
}

export async function getDocumentUrl(
  idToken: string,
  patientId: string,
  docId: string,
): Promise<DocumentDownloadUrl> {
  const res = await fetch(`${BASE_URL}/patients/${patientId}/documents/${docId}/download-url`, {
    headers: headers(idToken),
  });
  return jsonOrThrow<DocumentDownloadUrl>(res);
}

export async function deleteDocument(
  idToken: string,
  patientId: string,
  docId: string,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/patients/${patientId}/documents/${docId}`, {
    method: 'DELETE',
    headers: headers(idToken),
  });
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? null;
    } catch {
      /* not JSON */
    }
    throw new DocumentError(`http_${res.status}`, res.status, detail);
  }
}
