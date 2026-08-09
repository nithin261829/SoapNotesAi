// OTP verification API — compulsory login verification when enabled server-side.

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export interface OtpStatus {
  required: boolean;
  verified: boolean;
}

export interface OtpRequestResult {
  sent_to: string;
  channel: 'sms' | 'email' | 'dev_log';
  ttl_minutes: number;
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

export async function getOtpStatus(idToken: string): Promise<OtpStatus> {
  const res = await fetch(`${BASE_URL}/auth/otp/status`, { headers: headers(idToken) });
  return jsonOrThrow<OtpStatus>(res);
}

export async function requestOtp(idToken: string): Promise<OtpRequestResult> {
  const res = await fetch(`${BASE_URL}/auth/otp/request`, {
    method: 'POST',
    headers: headers(idToken),
  });
  return jsonOrThrow<OtpRequestResult>(res);
}

export async function verifyOtp(idToken: string, code: string): Promise<OtpStatus> {
  const res = await fetch(`${BASE_URL}/auth/otp/verify`, {
    method: 'POST',
    headers: headers(idToken),
    body: JSON.stringify({ code }),
  });
  return jsonOrThrow<OtpStatus>(res);
}

// ─── Phone-number login (no auth — the OTP is the login) ───────────

const plainHeaders = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

export async function requestPhoneLoginOtp(phone: string): Promise<OtpRequestResult> {
  const res = await fetch(`${BASE_URL}/auth/otp/phone/request`, {
    method: 'POST',
    headers: plainHeaders,
    body: JSON.stringify({ phone }),
  });
  return jsonOrThrow<OtpRequestResult>(res);
}

export async function verifyPhoneLoginOtp(
  phone: string,
  code: string,
): Promise<{ custom_token: string }> {
  const res = await fetch(`${BASE_URL}/auth/otp/phone/verify`, {
    method: 'POST',
    headers: plainHeaders,
    body: JSON.stringify({ phone, code }),
  });
  return jsonOrThrow<{ custom_token: string }>(res);
}
