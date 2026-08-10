# Razorpay go-live — enable pay-to-continue before Aug 17 2026

Billing enforcement is **ON** (`app_config/billing.enforce = true`). Doctors on
their 7-day trial can record freely; once a trial lapses the Record screen shows
a paywall and the only way back is subscribe / wallet top-up — which needs the
**live Razorpay keys below**. First trials expire **2026-08-17**. Until keys are
set, the "PAY" button cannot collect, so expired doctors would be stuck.

Disarm anytime while you sort this out: set `app_config/billing.enforce = false`
(Firestore, ~5 min to take effect, no redeploy).

## 1. Get the keys (Razorpay Dashboard)

1. Create/av activate the Razorpay account (KYC + bank account) at dashboard.razorpay.com.
2. Switch the dashboard to **Live mode** (toggle, top of page).
3. **Settings → API Keys → Generate Live Key** → copy `key_id` (starts `rzp_live_…`)
   and `key_secret` (shown once — save it now).

## 2. Register the webhook

1. **Settings → Webhooks → Add New Webhook**.
2. Webhook URL:
   ```
   https://soapnotesai-backend-z66y5cnt4q-uc.a.run.app/v1/billing/webhook
   ```
3. **Active events:** at minimum `payment.captured` (also fine to add
   `order.paid`). The backend keys fulfillment off the captured payment.
4. Set a **Secret** (any strong random string) — copy it; this is `webhook_secret`.
   The backend HMAC-verifies every webhook with it.

## 3. Put the keys in Firestore (never in env files)

Firestore → collection `app_config` → doc `razorpay` (create if missing):

| Field | Value |
|---|---|
| `key_id` | `rzp_live_…` |
| `key_secret` | (live secret from step 1) |
| `webhook_secret` | (secret from step 2) |

Takes effect within ~5 min (in-process cache) — no redeploy. That immediately
lights up `/v1/billing/orders`, `/verify`, and the `/webhook` fulfillment path.

## 4. Verify end to end

1. In the app: Payments → buy the smallest thing (wallet top-up or a plan).
2. Confirm the Razorpay checkout opens with **live** branding (not "Test Mode").
3. Complete a real ₹ payment (or use a live card you control, then refund).
4. Check Firestore: `organizations/{org}/billing/wallet` balance rose, and a
   `wallet/transactions/{id}` credit row exists; for a plan, the clinic's
   `subscription_{clinicId}` doc is `active` with a `current_period_end`.
5. In Razorpay Dashboard → Webhooks, confirm the delivery shows **200**.

## Notes

- **Prices** live in `app_config/pricing` (editable, no redeploy) over the code
  defaults in `backend/app/services/pricing.py` (₹499 Standard / ₹799 Premium
  per clinic per 30 days, ₹5/note payg, ₹500 joining fee).
- **Renewals are manual** — a plan lasts 30 days, then lapses; the daily
  `subscription-sweep` job flips it to `expired` and reminds the owner 3 days
  before + on expiry. True auto-charge (Razorpay Subscriptions / UPI e-mandate)
  is a separate, larger integration for later.
- Refunds / disputes: handle in the Razorpay Dashboard; there is no in-app
  refund flow yet.
