# SoapNotesAi — Deployment Runbook (end to end)

This is the complete operations guide. A new engineer with access to the
Google Cloud project and this repo should be able to run everything from
this document alone.

## The system at a glance

| Surface | Tech | Where it runs | Deploy command |
|---|---|---|---|
| Backend API | FastAPI (Python 3.12) | Cloud Run `soapnotesai-backend`, us-central1 | `deploy/scripts/deploy.sh` |
| Web dashboard | Expo (React Native Web) | Firebase Hosting → **https://soapnotesai.web.app** | `deploy/scripts/deploy-web.sh` |
| Database rules | Firestore security rules | Firebase | `cd firebase && npx firebase-tools deploy --only firestore:rules --project soapnotesai-dev-f7e79` |
| Mobile apps | Expo / EAS | Play Store + App Store (pending) | `cd mobile && npx eas-cli build` |
| Daily reminders | Cloud Scheduler `soapnotesai-daily-reminders` | 7:00 AM IST → POST /v1/internal/reminders/run | already configured |

GCP/Firebase project: **soapnotesai-dev-f7e79** · GitHub: nithin261829/SoapNotesAi

## Prerequisites (one-time per machine)

1. `gcloud` CLI, authenticated to an account with access to the project:
   `gcloud auth login && gcloud config set project soapnotesai-dev-f7e79`
2. Node 20+ and `npx` (firebase-tools and eas-cli run via npx, no global install).
3. Python backend runs remotely — for local dev only: `uv` + `brew install pango`.
4. Local dev credentials: a service-account JSON at the path referenced by
   `backend/.env` → `GOOGLE_APPLICATION_CREDENTIALS`. **Never commit it.**
   (Cloud Run does NOT use key files — it runs as its service account.)

## Deploying the backend

```bash
deploy/scripts/deploy.sh              # build image on Cloud Build + deploy new revision
SKIP_BUILD=1 deploy/scripts/deploy.sh # config-only redeploy (env vars, CORS)
deploy/scripts/status.sh              # URL, revisions, traffic, health
deploy/scripts/logs.sh                # live logs (or `logs.sh ERROR`)
deploy/scripts/rollback.sh            # back to the previous revision
```

Verify after every deploy:
```bash
curl https://soapnotesai-backend-z66y5cnt4q-uc.a.run.app/health
# → {"status":"ok", "build_time": <must be the build you just made>}
```

Non-secret env (CORS origins, Vertex project, limits) lives inside
`deploy/scripts/deploy.sh` in the ENV_FILE block — edit there, then
`SKIP_BUILD=1 ./deploy.sh`.

## Deploying the web dashboard

```bash
deploy/scripts/deploy-web.sh
```

That's it — builds the web bundle with the production API URL and publishes
https://soapnotesai.web.app. If the backend URL ever changes, pass
`API_URL=https://new-url ./deploy-web.sh` and also add the new origin to
CORS (see backend section) and to Firebase Auth authorized domains
(Firebase console → Authentication → Settings → Authorized domains).

## Deploying Firestore rules

```bash
cd firebase
npx --yes firebase-tools deploy --only firestore:rules --project soapnotesai-dev-f7e79
```

Rules live in `firebase/firestore.rules`. They enforce org/clinic tenancy,
deny clients all access to `usage`, `app_config`, `payments`, and restrict
`billing/*` to org owners and clinical writes to clinician roles.

## Secrets & runtime configuration — ALL in Firestore, never in env files

Console: https://console.firebase.google.com/project/soapnotesai-dev-f7e79/firestore
→ collection **app_config** (clients can never read it):

| Doc | Fields | Purpose |
|---|---|---|
| `razorpay` | `key_id`, `key_secret`, `webhook_secret` | Payments. Also point a Razorpay-dashboard webhook (payment.captured) at `<backend-url>/v1/billing/webhook` |
| `sms` | `authkey`, `template_id` (MSG91) | OTP SMS delivery (login + verification) |
| `smtp` | `host`, `port`, `username`, `password`, `from` | OTP email delivery |
| `billing` | `enforce` (bool), `letterhead_change_fee_paise` | Billing kill-switch — flip `enforce: true` to start charging/capping |
| `auth` | `otp_required` (bool) | OTP second-factor kill-switch |
| `scheduler` | `invoker_email`, `audience` | Reminder-runner auth overrides (defaults are fine) |
| `counters` | `registration_seq` | Doctor-ID counter — never edit manually |

Changes take effect within ~5 minutes (in-process cache), no redeploy.

## Admin operations (Firestore console)

- **Approve a doctor's verification**: `users/{uid}` → set
  `verification_status: "verified"` (or `"rejected"` + `verification.rejection_reason`).
  The verified badge then prints on their PDFs automatically.
- **Change reminder time**: `gcloud scheduler jobs update http
  soapnotesai-daily-reminders --location us-central1 --schedule "0 7 * * *"
  --time-zone Asia/Kolkata`
- **Grant/revoke wallet balance manually**: don't. Use Razorpay flows; for
  support credits add a wallet transaction via a backend script so the ledger
  stays consistent.

## Mobile builds (EAS)

```bash
cd mobile
npx eas-cli login                # once per machine (Expo account)
npx eas-cli build --profile development --platform android   # dev build (Google sign-in, Razorpay, push)
npx eas-cli build --profile production --platform android    # Play Store AAB
npx eas-cli build --profile production --platform ios        # App Store (needs Apple Developer account)
npx eas-cli submit                                            # store submission
```

Store copy + asset checklist: `docs/store/listing.md`. Privacy policy to host:
`docs/store/privacy-policy.md`.

## Monitoring

- Uptime check `soapnotesai-health` probes `/health` every 5 min; failures
  email **you@example.com** (Cloud Monitoring alert).
- Logs: `deploy/scripts/logs.sh` or Cloud Console → Cloud Run → Logs.
- Before real launch: set `MIN_INSTANCES=1` in `deploy/scripts/env.sh` and
  redeploy to eliminate cold starts (~₹500–800/month).

## Tests — run before every backend deploy

```bash
cd backend && uv run pytest -q     # 66 tests; money/auth paths — must be green
cd mobile && npx tsc --noEmit      # mobile/web typecheck — must be clean
```

## Git discipline

- Push after every completed task: `git add -A && git commit && git push`.
- NEVER commit: `.env` files, `*firebase-adminsdk*.json` (gitignored; the
  2026-08 admin key that leaked into history was rotated and is dead).

## Incident quick-reference

| Symptom | First move |
|---|---|
| Web app can't reach API (CORS errors in console) | Origin missing from CORS list in deploy.sh → `SKIP_BUILD=1 ./deploy.sh` |
| Payments 503 `payments_not_configured` | `app_config/razorpay` keys missing |
| OTP says delivery not configured | `app_config/sms` or `/smtp` missing |
| Doctors blocked from notes unexpectedly | Check `app_config/billing.enforce` — flip to `false` to disarm instantly |
| Backend down alert email | `deploy/scripts/status.sh`, then `rollback.sh` if the last deploy caused it |
| PDF renders without letterhead/badge | Clinic letterhead unset, or doctor not `verification_status=verified` |
