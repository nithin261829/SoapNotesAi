// Billing API: wallet, plans, Razorpay order create + verify.
// All prices come from the backend — the app never decides amounts.

const BASE_URL = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'}/v1`;

export type PaymentPurpose =
  | 'wallet_topup'
  | 'joining_fee'
  | 'subscription_standard'
  | 'subscription_premium';

export interface Plan {
  id: string;
  name: string;
  badge: string;
  price_label: string;
  amount_paise: number | null;
  per_note_paise?: number;
  limit_label?: string;
  backup: string;
  features: string[];
}

export interface PlansResponse {
  joining_fee_paise: number;
  trial_days: number;
  per_note_paise: number;
  plans: Plan[];
}

export interface Subscription {
  tier: 'none' | 'payg' | 'standard' | 'premium';
  status: 'inactive' | 'trial' | 'active' | 'expired';
  joining_fee_paid: boolean;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
}

export interface WalletTransaction {
  type: 'credit' | 'debit';
  amount_paise: number;
  balance_after_paise: number;
  reason: string;
  created_at: string;
}

export interface WalletResponse {
  balance_paise: number;
  currency: string;
  subscription: Subscription;
  transactions: WalletTransaction[];
}

export interface CreateOrderResponse {
  order_id: string;
  amount_paise: number;
  currency: string;
  key_id: string;
  purpose: PaymentPurpose;
}

export interface VerifyResponse {
  status: string;
  purpose: PaymentPurpose;
  wallet_balance_paise: number;
  subscription: Subscription;
}

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'BillingError';
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
    throw new BillingError(`http_${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

export async function getPlans(idToken: string): Promise<PlansResponse> {
  const res = await fetch(`${BASE_URL}/billing/plans`, { headers: headers(idToken) });
  return jsonOrThrow<PlansResponse>(res);
}

export async function getWallet(idToken: string): Promise<WalletResponse> {
  const res = await fetch(`${BASE_URL}/billing/wallet`, { headers: headers(idToken) });
  return jsonOrThrow<WalletResponse>(res);
}

export async function createOrder(
  idToken: string,
  purpose: PaymentPurpose,
  amountInr?: number,
): Promise<CreateOrderResponse> {
  const res = await fetch(`${BASE_URL}/billing/orders`, {
    method: 'POST',
    headers: headers(idToken),
    body: JSON.stringify({ purpose, amount_inr: amountInr ?? null }),
  });
  return jsonOrThrow<CreateOrderResponse>(res);
}

export async function verifyPayment(
  idToken: string,
  params: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  },
): Promise<VerifyResponse> {
  const res = await fetch(`${BASE_URL}/billing/verify`, {
    method: 'POST',
    headers: headers(idToken),
    body: JSON.stringify(params),
  });
  return jsonOrThrow<VerifyResponse>(res);
}

export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  })}`;
}

export interface BillingStatus {
  state: 'active' | 'trial' | 'payg' | 'expired' | 'no_plan';
  can_create: boolean;
  enforced: boolean;
  trial_days_left: number | null;
  tier: string;
  wallet_balance_paise: number;
}

export async function getBillingStatus(idToken: string): Promise<BillingStatus> {
  const res = await fetch(`${BASE_URL}/billing/status`, { headers: headers(idToken) });
  return jsonOrThrow<BillingStatus>(res);
}
