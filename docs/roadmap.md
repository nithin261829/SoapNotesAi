# SoapNotesAi — Remaining Work Roadmap

Last updated: 2026-08-08 (billing + cost-privacy sprint)

This file captures what's done, what's next, and the key decisions so we can
pick back up later without re-deriving everything from chat history.

---

## ✅ 2026-08-08 sprint — cost privacy + Razorpay billing

- **AI cost hidden from clients**: tokens/cost/provider/model moved to
  backend-only `organizations/{org}/usage/{recordingId}` (deny-all rules);
  removed from Recording docs, API responses, embedded SOAP (`llm_*`), and
  all mobile UI. 66 legacy recording docs backfilled + scrubbed.
- **Razorpay billing backend** (`app/routers/billing.py`): plans / wallet /
  order create / verify (HMAC) / webhook, idempotent fulfillment in a
  Firestore transaction. Pricing server-side: ₹500 joining fee (7-day trial),
  ₹499 standard, ₹799 premium, ₹5/note, top-ups ₹50–₹50,000 (paise ints).
- **Keys in Firestore, not env** (user preference): `app_config/razorpay`
  doc, read via `app/services/app_config.py` (TTL cache, env fallback).
  → PENDING USER: paste real key_id/key_secret/webhook_secret into that doc
  and point a Razorpay-dashboard webhook (payment.captured) at
  `<cloud-run-url>/v1/billing/webhook`.
- **Mobile payments screen**: Settings → Payments & Plans (`app/payments.tsx`),
  wallet top-up presets/custom, plan matrix, joining fee, transactions.
  Razorpay checkout needs the dev/release build (Expo Go shows a clear alert).
- **Firestore rules deployed**; new deny-all matches for `usage`, `app_config`,
  `payments`; owner-read `billing`.
- **Fixed** `deploy/scripts/03-build-and-push.sh` REPO_ROOT `||`/`&&`
  precedence bug that produced a two-line repo root and broke deploys.

### Next (in priority order)
1. Enforce billing at note generation: ₹5 wallet debit on payg tier, daily
   30-case cap on standard, trial checks.
2. EAS dev build (unlocks BOTH Google Sign-In and Razorpay native SDK).
3. OTP login, doctor verification workflow + PDF verified badge.
4. Feature batch: dual-role accounts, follow-up engine + continuation pages,
   Excel export, reminders, gestures/greetings, inactivity banner, doc uploads.
5. Play Store / App Store submission via EAS.

---

## ✅ Done so far

### Mobile (Expo Go on iPhone)
- Recording via `expo-audio` (migrated from deprecated `expo-av`). Forced
  `numberOfChannels: 1` (mono) to avoid iOS AVAudioSession activation failure
  on real iPhone mic.
- Upload audio via `expo-file-system/legacy` `createUploadTask`.
- Editable SOAP UI (`SoapEditor.tsx`) — every field is a real input, chip
  lists with add/remove, medication rows, vitals grid.
- Generate-PDF button → backend renders → `expo-sharing` opens iOS share
  sheet (AirDrop / Save to Files / Mail / Print).
- Cost row shows input tokens, output tokens, estimated USD.
- Firebase Web SDK with AsyncStorage persistence so signed-in state survives
  cold launch.
- Email/password sign-in/sign-up screen (Google button kept as placeholder
  with explanation that it needs a dev build — see Phase 5).
- AuthGate in root layout redirects between `(auth)` and `(tabs)` based on
  auth state.

### Backend (FastAPI :8001)
- `POST /audio/upload` — receives audio, runs `AudioToSoap` provider, returns
  `{transcript, soap, prompt_tokens, output_tokens, estimated_cost_usd}`.
- `POST /soap/pdf` — Jinja2 + WeasyPrint renders the proper SOAP template
  (requires `brew install pango` on the host machine).
- AI provider: Vertex AI Gemini 2.5 Flash (single multimodal call: audio →
  transcript + structured SOAP). Provider is hidden from the UI; only "AI
  engine" / "Complete" labels are user-visible.
- Provider swap point lives at `app/interfaces/audio_to_soap.py`. Dead STT/TTS
  protocol files removed.
- Firebase Admin SDK initialized via service-account JSON at
  `~/Documents/Python_project/SoapNotesAi/soapnotesai-dev-f7e79-firebase-adminsdk-fbsvc-2b15098824.json`
  (path in `backend/.env` as `GOOGLE_APPLICATION_CREDENTIALS`). `.gitignore`
  patterns protect it from accidental commit.
- `GRPC_DNS_RESOLVER=native` + `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`
  required when running the backend so:
  - gRPC routes to Vertex AI over IPv4 (the dev box has broken IPv6)
  - WeasyPrint finds `libpango` from Homebrew

### Data model — 3-layer tenancy (Organization → Clinic → Patient → Recording)
- `models/organization.py` — new top-level tenant.
- `models/user_profile.py` — new `users/{uid}` global doc with
  `memberships: [{clinic_id, role}, ...]`.
- `models/clinic.py` — added `org_id`.
- `models/patient.py` — added `org_id`, `clinic_id` (denormalized for
  collectionGroup queries).
- `models/recording.py` — added `org_id`/`clinic_id`/`patient_id`, embedded
  `SoapNote` inline (no separate subcollection), added cost fields, neutral
  `ai_provider`/`ai_model_version` field names.
- `models/soap.py` — dropped `pdf_storage_path` (we don't store PDFs;
  re-render on demand from `recording.soap`).
- `models/audit.py` — added `org_id`/`clinic_id`.

### Security rules (updated in repo — NOT YET DEPLOYED to Firebase project)
- `firebase/firestore.rules` — rewritten for org/clinic tenancy. Checks
  `request.auth.token.org_id == oid` and
  `request.auth.token.active_clinic_id == cid` on tenant data. Owner-only
  for audit reads + invites.
- `firebase/storage.rules` — same: clinical artifacts live at
  `organizations/{orgId}/clinics/{clinicId}/...` and require matching token
  claims.

### Auth deps
- `backend/app/auth/deps.py` — `current_user`, `tenant_user`,
  `require_owner` FastAPI dependencies reading the new claim shape
  (`org_id`, `active_clinic_id`, `role`).

---

## 🔴 Critical action — DEPLOY THE RULES

The rules in the repo aren't enforced until they're deployed to the Firebase
project. Until then, the old single-clinic rules are still active.

```bash
firebase deploy --only firestore:rules,storage --project soapnotesai-dev-f7e79
```

If `firebase-tools` isn't installed:
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage --project soapnotesai-dev-f7e79
```

The backend can keep developing in the meantime — Admin SDK bypasses rules.
But you can't test client-side reads/writes (or audit a leaky claim) without
the deployment.

---

## 🟡 Phase 2 — Sign-up + tenancy provisioning (~3h, do next)

Without this, no endpoint can know who the caller is or which clinic the
data belongs to.

### Backend
1. `POST /signup/org` — auth'd user with no org → creates `Organization` +
   first `Clinic` + `UserProfile`, sets custom claims (`org_id`,
   `active_clinic_id`, `role=owner`) via `firebase_admin.auth.set_custom_user_claims`.
2. `POST /signup/invite/{code}` — validates invite, adds user to org with
   the role on the invite, sets claims.
3. `POST /invites` (owner only) — creates a single-use code for a specific
   clinic + role.
4. `POST /clinic-switch` — multi-clinic users switch active clinic; updates
   `active_clinic_id` + `role` claims; mobile forces a token refresh.
5. `GET /me` — returns the caller's `UserProfile` + memberships (for the
   mobile clinic switcher dropdown).

### Mobile
6. Sign-up screen — add a mode toggle: "Create new org" vs "Join with code".
7. On first sign-in, detect missing `org_id` claim → push user through
   create-or-join flow.
8. After creating/joining: force `await user.getIdToken(true)` so the fresh
   claims land in the local Firebase user.
9. Profile tab — show org name + clinic switcher dropdown (populated from
   `GET /me` memberships).
10. Wire all subsequent requests to send `Authorization: Bearer <ID token>`
    via `idToken` param already supported in `recordings.ts`.

---

## 🟡 Phase 3 — Patient + recording persistence (~3h)

The "save under patient as a folder" work.

### Backend
11. `POST /patients` — create patient under
    `organizations/{oid}/clinics/{cid}/patients/{pid}`.
12. `GET /patients` — list patients in active clinic.
13. Modify `POST /audio/upload`:
    - Require `tenant_user` auth dep.
    - Accept `patient_id` form field.
    - Upload audio bytes to GCS at
      `organizations/{oid}/clinics/{cid}/patients/{pid}/recordings/{rid}/audio.m4a`.
    - Write `Recording` Firestore doc at the matching path with
      `audio_storage_path`, transcript, embedded SOAP, cost metadata.
14. `GET /recordings?patient_id=...` — list recordings under a patient
    (ordered by `created_at desc`).
15. `GET /recordings/{id}` — fetch one (for the detail screen).
16. `PATCH /recordings/{id}` — overwrite `soap` field on edits; stamp
    `edited_by_doctor=True`, `updated_at`.
17. `GET /recordings/{id}/pdf` — read `recording.soap` from Firestore +
    render + stream. Replaces the current `POST /soap/pdf` which takes the
    SOAP in the request body.

### Mobile
18. Patients tab — list patients (`GET /patients`) + "Add patient" form.
19. Patient detail screen — recordings list (`GET /recordings?patient_id=`).
20. Recording detail screen — transcript + SoapEditor + Share/Download PDF
    buttons that call `GET /recordings/{id}/pdf` each time (no caching).
21. Record screen — patient picker step before "Send for processing" sends
    `patient_id` with the upload.
22. All `recordings.ts` calls send `idToken` (already plumbed through, just
    needs to be passed from the call sites).

---

## 🟢 Phase 4 — Polish (~2-3h)

23. Audit log writes on key actions: create patient, view recording, edit
    SOAP, sign SOAP, export PDF. Backend writes to
    `organizations/{oid}/clinics/{cid}/audit/{eventId}`. NO PHI in audit
    records — uid + action + target IDs only.
24. Doctor sign-off flow — explicit "Sign this note" button stamps
    `signed_at` + `signed_by_uid` on the SoapNote and locks further edits.
25. Error states + retry on network/quota failures (especially Vertex 429
    quota_exceeded).
26. Patient search/filter on the list screen.
27. Sign-out: clear local state, force re-auth on token expiry.

---

## ⚪ Phase 5 — Optional / future

| # | Item | Notes |
|---|---|---|
| 28 | Live partial transcript | Replace expo-audio capture with PCM streaming + WebSocket + streaming STT (Google Speech / Deepgram / AssemblyAI). Significantly bigger architecture change. |
| 29 | Google sign-in | Requires custom Expo **dev build** (Expo Go's bundle ID is `host.exp.Exponent` which Google can't whitelist). Add iOS OAuth client in GCP Console with bundle ID `com.soapnotesai.app`, pass as `iosClientId` to `useIdTokenAuthRequest`. |
| 30 | Phone (SMS) sign-in | Same: requires dev build + `@react-native-firebase/auth`. |
| 31 | Hallucination verifier agent | Second AI call: re-read transcript and clear any SOAP field not supported by it. Doubles cost per recording. |
| 32 | Drug name validator | RxNorm lookup on each medication. Free, low-latency. |
| 33 | Vitals plausibility check | Flag BP=400/250, HR=300, etc. Pure code, no AI. |
| 34 | ICD-10 suggester | Propose codes from diagnoses for billing. Another AI call or a lookup table. |
| 35 | Cost dashboard per clinic | Aggregate `estimated_cost_usd` over time, surface in Profile or admin screen. |

---

## Decisions locked in

- **Don't store PDFs.** Always regenerate from stored SOAP. Saves Storage
  cost and avoids drift if the doctor edits later.
- **Embed SoapNote inline** in the Recording doc, not a subcollection.
  One read fetches everything. Edits overwrite.
- **3-layer tenancy** (Organization → Clinic → Patient → Recording). Users
  can be in multiple clinics within an org.
- **Custom claims carry the active context** (`org_id`, `active_clinic_id`,
  `role`); the global `users/{uid}` doc carries the full memberships list.
- **Both sign-up paths**: create-new-org OR join-with-invite-code.
- **Direct-to-AI-multimodal** for audio→SOAP (option A from earlier chat).
  No separate streaming STT in v1.
- **Email/password auth** in Expo Go now; Google + Phone in a future dev
  build.
- **Cost shown to the doctor** — input tokens, output tokens, estimated USD
  on the result card.

---

## Runtime gotchas (so we don't rediscover them)

- **Metro started with `CI=1`** — disables file watching. After any JS
  change, restart Metro: `pkill -f 'expo start' && CI=1 npx expo start --tunnel --clear`.
- **Two ngrok tunnels needed** — one for Metro (Expo CLI), one for backend.
  Backend tunnel URL is in `mobile/.env` as `EXPO_PUBLIC_API_BASE_URL` and
  is **baked into the JS bundle at build time** — changing it requires a
  Metro restart.
- **Backend must be started with**:
  ```bash
  GRPC_DNS_RESOLVER=native DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
    uv run uvicorn app.main:app --reload --port 8001
  ```
- **iOS simulator vs Expo Go on iPhone**: simulator mic must be enabled in
  Device → Microphone → Use Microphone. On Expo Go via tunnel, the mic
  permission prompt says "Expo Go", which is normal.
- **Force-close Expo Go** between JS changes (CI=1 means Reload from dev
  menu is disabled). Swipe up + away, re-scan QR / re-open URL.
- **WeasyPrint native deps** must be installed: `brew install pango`. After
  install, restart the backend so the dynamic linker picks them up.

---

## Action items the user owes (paste into the next session)

1. Deploy Firestore + Storage rules:
   `firebase deploy --only firestore:rules,storage --project soapnotesai-dev-f7e79`
2. (Optional) Move the service-account JSON outside the repo to
   `~/.gcp/soapnotesai-dev.json` and update `GOOGLE_APPLICATION_CREDENTIALS`
   in `backend/.env`.
3. Decide: keep `users/{uid}` writable by backend only (current rule)? Yes
   for security; this is what the rule already does.

---

## How to resume the session

1. Read this file.
2. Confirm rules are deployed.
3. Start Metro + backend with the env vars from "Runtime gotchas".
4. Start Phase 2: backend signup endpoints first, then mobile screens.
