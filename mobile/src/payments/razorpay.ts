// Thin wrapper over react-native-razorpay. The native module only exists in a
// custom dev/release build — in Expo Go we surface a clear "needs dev build"
// error instead of crashing (same pattern as Google sign-in).

export interface CheckoutParams {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  name: string; // merchant / app name shown in the sheet
  description: string;
  prefillEmail?: string;
  prefillContact?: string;
  themeColor?: string;
}

export interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export class RazorpayUnavailableError extends Error {
  constructor() {
    super('Razorpay checkout needs a development or release build (not Expo Go).');
    this.name = 'RazorpayUnavailableError';
  }
}

export class CheckoutCancelledError extends Error {
  constructor() {
    super('Payment was cancelled.');
    this.name = 'CheckoutCancelledError';
  }
}

function loadNativeModule(): { open: (options: object) => Promise<CheckoutSuccess> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-razorpay');
    const checkout = mod?.default ?? mod;
    if (checkout && typeof checkout.open === 'function') return checkout;
    return null;
  } catch {
    return null;
  }
}

export function isRazorpayAvailable(): boolean {
  return loadNativeModule() != null;
}

export async function openCheckout(params: CheckoutParams): Promise<CheckoutSuccess> {
  const native = loadNativeModule();
  if (!native) throw new RazorpayUnavailableError();
  try {
    return await native.open({
      key: params.keyId,
      order_id: params.orderId,
      amount: params.amountPaise,
      currency: params.currency,
      name: params.name,
      description: params.description,
      prefill: {
        email: params.prefillEmail,
        contact: params.prefillContact,
      },
      theme: { color: params.themeColor ?? '#E8FF3C' },
    });
  } catch (e: unknown) {
    // The SDK rejects with {code, description}; code 0/2 = user cancelled.
    const err = e as { code?: number; description?: string };
    if (err?.code === 0 || err?.code === 2) throw new CheckoutCancelledError();
    throw new Error(err?.description ?? 'Payment failed');
  }
}
