// Audio upload to the backend. Local-mode v1: the audio file stays on the
// device (canonical copy); this sends a transient copy and the backend runs
// the audio → SOAP pipeline.

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import type { SoapNote } from '@/types/soap';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export interface AudioUploadResponse {
  recording_id: string;
  patient_id: string;
  patient_name: string;
  patient_created: boolean;
  size_bytes: number;
  mime_type: string;
  client_duration_ms: number | null;
  received_at: string;
  transcript: string;
  soap: SoapNote;
}

export interface GeneratePdfParams {
  soap: SoapNote;
  transcript?: string;
  clinicName?: string;
  doctorName?: string;
  doctorCredentials?: string;
  idToken?: string;
}

/** Renders the edited SOAP server-side and writes the PDF to a local file. Returns the URI. */
export async function generateSoapPdf(params: GeneratePdfParams): Promise<string> {
  const url = `${BASE_URL}/soap/pdf`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...(params.idToken ? { Authorization: `Bearer ${params.idToken}` } : {}),
    },
    body: JSON.stringify({
      soap: params.soap,
      transcript: params.transcript ?? null,
      clinic_name: params.clinicName ?? null,
      doctor_name: params.doctorName ?? null,
      doctor_credentials: params.doctorCredentials ?? null,
    }),
  });
  if (!res.ok) {
    let code: string | null = null;
    try {
      const parsed = (await res.json()) as { detail?: string };
      code = parsed.detail ?? null;
    } catch {
      /* ignore */
    }
    throw new UploadError(`pdf_failed_${res.status}`, res.status, code);
  }
  const buf = await res.arrayBuffer();
  // Web: trigger a normal browser download (native file APIs don't exist).
  if (Platform.OS === 'web') {
    return webDownloadBlob(buf, `soap_${Date.now()}.pdf`);
  }
  // Native: expo-file-system/legacy doesn't support writing arbitrary binary
  // blobs from fetch, so encode the response as base64 and write that.
  const base64 = arrayBufferToBase64(buf);
  const dir = `${FileSystem.documentDirectory}pdfs/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const filename = `soap_${Date.now()}.pdf`;
  const fileUri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

/** Fetch a short-lived signed URL for playback of the stored audio. */
export async function getRecordingAudioUrl(
  idToken: string,
  recordingId: string,
  patientId: string,
): Promise<string> {
  const url = `${BASE_URL}/recordings/${encodeURIComponent(recordingId)}/audio-url?patient_id=${encodeURIComponent(patientId)}`;
  const res = await fetch(url, {
    headers: {
      'ngrok-skip-browser-warning': 'true',
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    let code: string | null = null;
    try {
      const parsed = (await res.json()) as { detail?: string };
      code = parsed.detail ?? null;
    } catch {
      /* ignore */
    }
    throw new UploadError(`audio_url_failed_${res.status}`, res.status, code);
  }
  const body = (await res.json()) as { url: string };
  return body.url;
}

/** Render and save the PDF for an already-persisted Recording. */
export async function downloadRecordingPdf(
  idToken: string,
  recordingId: string,
  patientId: string,
): Promise<string> {
  const url = `${BASE_URL}/recordings/${encodeURIComponent(recordingId)}/pdf?patient_id=${encodeURIComponent(patientId)}`;
  const res = await fetch(url, {
    headers: {
      'ngrok-skip-browser-warning': 'true',
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    let code: string | null = null;
    try {
      const parsed = (await res.json()) as { detail?: string };
      code = parsed.detail ?? null;
    } catch {
      /* ignore */
    }
    throw new UploadError(`pdf_failed_${res.status}`, res.status, code);
  }
  const buf = await res.arrayBuffer();
  if (Platform.OS === 'web') {
    return webDownloadBlob(buf, `soap_${recordingId}.pdf`);
  }
  const base64 = arrayBufferToBase64(buf);
  const dir = `${FileSystem.documentDirectory}pdfs/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const filename = `soap_${recordingId}_${Date.now()}.pdf`;
  const fileUri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}


function webDownloadBlob(buf: ArrayBuffer, filename: string): string {
  const blob = new Blob([buf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // RN's btoa is missing/limited; build it from raw bytes manually.
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  // global.btoa exists in Hermes; fall back to a manual encode if not.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.btoa === 'function') return g.btoa(binary);
  // Manual base64 (rare path).
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  // Indices into `chars` are always in [0, 63], so the `!` is safe.
  for (; i + 2 < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = binary.charCodeAt(i + 1);
    const c = binary.charCodeAt(i + 2);
    out += chars[a >> 2]! + chars[((a & 3) << 4) | (b >> 4)]! + chars[((b & 15) << 2) | (c >> 6)]! + chars[c & 63]!;
  }
  if (i < binary.length) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    out += chars[a >> 2]! + chars[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < binary.length ? chars[(b & 15) << 2]! : '=';
    out += '=';
  }
  return out;
}

export interface UploadParams {
  fileUri: string;
  /** Omit for "new patient" mode — the backend will auto-create from the audio. */
  patientId?: string;
  durationMs?: number | null;
  encounterDate?: string; // ISO date (YYYY-MM-DD)
  idToken?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export async function uploadAudio(params: UploadParams): Promise<AudioUploadResponse> {
  const url = `${BASE_URL}/audio/upload`;

  // Web: expo-file-system upload tasks are native-only. Fetch the recorded
  // blob URL and post multipart FormData directly.
  if (Platform.OS === 'web') {
    const blob = await (await fetch(params.fileUri)).blob();
    const fd = new FormData();
    fd.append(
      'audio',
      new File([blob], 'audio.webm', { type: blob.type || 'audio/webm' }),
    );
    if (params.patientId) fd.append('patient_id', params.patientId);
    if (params.durationMs != null)
      fd.append('client_duration_ms', String(Math.round(params.durationMs)));
    if (params.encounterDate) fd.append('encounter_date', params.encounterDate);
    params.onProgress?.(0.5);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'ngrok-skip-browser-warning': 'true',
        ...(params.idToken ? { Authorization: `Bearer ${params.idToken}` } : {}),
      },
      body: fd,
      signal: params.signal,
    });
    params.onProgress?.(1);
    if (!res.ok) {
      let code: string | null = null;
      try {
        code = ((await res.json()) as { detail?: string }).detail ?? null;
      } catch {
        /* not JSON */
      }
      throw new UploadError(`upload_failed_${res.status}`, res.status, code);
    }
    return (await res.json()) as AudioUploadResponse;
  }

  const parameters: Record<string, string> = {};
  if (params.patientId) parameters.patient_id = params.patientId;
  if (params.durationMs != null) parameters.client_duration_ms = String(Math.round(params.durationMs));
  if (params.encounterDate) parameters.encounter_date = params.encounterDate;

  const task = FileSystem.createUploadTask(
    url,
    params.fileUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: 'audio/m4a',
      parameters,
      headers: {
        // Always set so ngrok's browser-warning interstitial never hits us.
        'ngrok-skip-browser-warning': 'true',
        ...(params.idToken ? { Authorization: `Bearer ${params.idToken}` } : {}),
      },
    },
    (event) => {
      if (!params.onProgress) return;
      const total = event.totalBytesExpectedToSend;
      if (total > 0) params.onProgress(event.totalBytesSent / total);
    },
  );

  if (params.signal) {
    if (params.signal.aborted) throw new UploadError('aborted', null, 'aborted');
    params.signal.addEventListener('abort', () => {
      task.cancelAsync().catch(() => {
        /* ignore */
      });
    });
  }

  const result = await task.uploadAsync();
  if (!result) {
    throw new UploadError('no_result', null, null);
  }
  if (result.status >= 400) {
    let code: string | null = null;
    try {
      const parsed = JSON.parse(result.body) as { detail?: string };
      code = parsed.detail ?? null;
    } catch {
      // body wasn't JSON; ignore.
    }
    throw new UploadError(`upload_failed_${result.status}`, result.status, code);
  }
  try {
    return JSON.parse(result.body) as AudioUploadResponse;
  } catch {
    throw new UploadError('invalid_response_body', result.status, null);
  }
}
