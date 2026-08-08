# Architecture

## High-level flow

```
┌────────────────┐     1. record m4a       ┌──────────────────┐
│ Mobile (Expo)  │  ─────────────────────▶ │ FastAPI backend  │
│  Record tab    │  ◀───── progress ────── │                  │
└────────────────┘                         │  ┌────────────┐  │
                                           │  │ Pipeline   │  │
                                           │  │            │  │
                                           │  │ 2. Storage │──┼──▶ Cloud Storage for Firebase
                                           │  │ 3. STT     │──┼──▶ Google Cloud Speech-to-Text
                                           │  │ 4. LLM     │──┼──▶ Vertex AI (Gemini)
                                           │  │ 5. PDF     │──┼──▶ WeasyPrint
                                           │  │ 6. Save    │──┼──▶ Firestore + Storage
                                           │  └────────────┘  │
                                           └──────────────────┘
```

All four external services sit behind a Python `Protocol` in `backend/app/interfaces/`. The Google implementations live in `backend/app/providers/` and are wired via `backend/app/config.py`. To swap a provider (e.g. self-hosted Whisper instead of Google STT), add a new class implementing the Protocol and switch the wiring — no caller changes.

## Auth flow

1. Mobile signs in with Firebase Auth (email/password).
2. Mobile obtains an ID token, sends it as `Authorization: Bearer <token>` on every backend request.
3. FastAPI middleware verifies the token with the Firebase Admin SDK.
4. The verified token's custom claim `clinicId` becomes the security boundary for all reads/writes.

The backend never trusts the client for `clinicId` or `uid` — it reads them from the verified token only.

## Data ownership

Top-level: `clinics/{clinicId}`. Everything else (doctors, patients, recordings, SOAP notes, audit) is nested under a clinic. Firestore rules check `request.auth.token.clinicId == clinicId`. Storage rules mirror that.

See `docs/soap-notes-app-claude-code-prompt.md` for the full collection layout and SOAP schema.

## Pipeline status machine

A `recording` document moves through:

```
uploaded → transcribed → structured → completed
                          ↘ failed (with step + code, NO PHI)
```

Each step is idempotent and individually retryable so a failure in (e.g.) PDF generation doesn't force re-recording.
