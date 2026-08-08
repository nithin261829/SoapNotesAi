# SoapNotesAi

Voice-driven SOAP-notes app for clinicians. Doctor dictates a patient encounter; the app transcribes (STT), structures it into a SOAP note (LLM), renders a PDF, and stores it under the patient's record.

**Status:** v1 scaffold — synthetic / test data only. Do **not** load real Protected Health Information (PHI) until the BAA + HIPAA-eligibility verification below is complete.

## Stack

| Layer | Choice |
|---|---|
| Mobile | React Native + Expo (TypeScript), expo-router, 3 bottom tabs |
| Backend | Python 3.12 + FastAPI, Pydantic v2 |
| Data | Firebase Cloud Firestore |
| File storage | Cloud Storage for Firebase |
| Auth | Firebase Authentication (email/password v1) |
| STT | Google Cloud Speech-to-Text (behind `SpeechToText` interface) |
| LLM | Gemini via Vertex AI (behind `SoapStructurer` interface) |
| TTS (optional) | Google Cloud Text-to-Speech (behind `TextToSpeech` interface) |
| PDF | WeasyPrint (HTML/CSS template → PDF) |
| Dep mgmt | `uv` (backend), `npm` (mobile) |

Every provider is behind a Protocol so a self-hosted / BAA-covered alternative can replace the Google default later.

## Repo layout

```
backend/   FastAPI service, Pydantic models, provider interfaces
mobile/    Expo app, expo-router screens, typed REST client
firebase/  Security rules + Firebase project config (no secrets)
docs/      Architecture and compliance notes; original spec
```

## Local setup

### Prerequisites
- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/) (`brew install uv` or `pipx install uv`)
- Node 20+ and `npm`
- Firebase CLI (`npm i -g firebase-tools`) — only needed for emulator + deploying rules
- A Firebase project (see Firebase setup below)

### Backend
```bash
cd backend
cp .env.example .env       # fill in FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS, etc.
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### Mobile
```bash
cd mobile
cp .env.example .env
npm install
npx expo start
```
Press `i` for iOS simulator, `a` for Android emulator, `w` for web preview.

### Firebase
1. Create a Firebase project in the [console](https://console.firebase.google.com/).
2. Enable Authentication → Email/Password.
3. Create a Firestore database (production mode).
4. Create a Cloud Storage bucket.
5. Download a service-account JSON key and set `GOOGLE_APPLICATION_CREDENTIALS` in `backend/.env` to its absolute path. **Do not commit this file.**
6. Deploy rules from `firebase/`:
   ```bash
   cd firebase
   firebase deploy --only firestore:rules,storage
   ```

## Tenancy model

Clinic-scoped. Every doctor belongs to a Clinic and carries a Firebase custom claim `clinicId`. All patient/recording/SOAP data lives under `clinics/{clinicId}/...`. Firestore + Storage rules enforce the boundary; backend re-checks on every endpoint.

## Disclaimer (also shown in-app)

The generated SOAP notes are a **draft assistive tool**. They must be reviewed, corrected, and signed by a licensed clinician before any clinical use. This software is **not** a substitute for professional medical judgment.

## PHI / HIPAA / BAA — read before going live

This codebase is built so HIPAA compliance is *achievable*, not so it is automatic. Before storing real PHI:

- [ ] Sign a Google Cloud BAA covering Firebase Auth, Firestore, Cloud Storage, Cloud Speech-to-Text, Cloud Text-to-Speech, and Vertex AI (Gemini).
- [ ] Verify each service is on Google's HIPAA-eligible services list under your BAA. **Not every Firebase service is covered.**
- [ ] Verify Vertex AI region + opt out of any logging/data-retention defaults that would expose PHI to non-BAA pathways.
- [ ] Confirm Cloud Speech-to-Text data-logging is disabled for PHI traffic.
- [ ] Audit `backend/app/services/audit.py` and confirm no PHI is captured in audit events or logs.
- [ ] Penetration test + Firestore/Storage rules review.
- [ ] Disable any third-party analytics that could see PHI.

See `docs/compliance-notes.md` for the full list of places PHI leaves the system.

## Build progress

Per `docs/soap-notes-app-claude-code-prompt.md`:

- [x] **Step 1** — Repo scaffold + Firebase config + Pydantic models + env loading
- [x] **Step 2** — Bottom-tab navigation with placeholder screens
- [x] **Step 3** — Record screen (mic, pause/resume/confirm, timer, local save)
- [x] **Step 4** — Audio multipart upload to backend (transient processing; local-files-only v1)
- [x] **Steps 5 + 6** — Audio → transcript + structured SOAP via Vertex AI Gemini multimodal (one call replaces separate STT + LLM steps)
- [ ] **Step 7** — Editable SOAP preview
- [ ] **Step 8** — PDF generation (WeasyPrint)
- [ ] **Step 9** — Firestore persistence + Patients tab
- [ ] **Step 10** — Profile tab
- [ ] **Step 11** — Auth + ID-token verification + security rules + audit logging
- [ ] **Step 12** — Error/retry hardening + loading UX
# soapNots-ai-
