# Architecture

## High-level flow

```
┌────────────────┐  1. record m4a + ID token  ┌────────────────────────┐
│ Mobile (Expo)  │ ─────────────────────────▶ │ FastAPI backend        │
│  Record tab    │ ◀─── transcript + SOAP ─── │ POST /v1/audio/upload  │
└────────────────┘                            │                        │
                                              │ 2. Audio → SOAP ───────┼──▶ Vertex AI Gemini 2.5 (one multimodal call)
                                              │ 3. Validate (Pydantic) │
                                              │ 4. Save audio ─────────┼──▶ Cloud Storage for Firebase
                                              │ 5. Save chart ─────────┼──▶ Firestore
                                              │ 6. PDF on demand ──────┼──▶ WeasyPrint
                                              └────────────────────────┘
```

Gemini 2.5 is multimodal, so one call returns both the verbatim transcript and the structured SOAP note; there is no separate speech-to-text step. That call sits behind the `AudioToSoap` Protocol in `backend/app/interfaces/audio_to_soap.py`, with the Vertex implementation in `backend/app/providers/vertex_gemini.py` and a `fake` provider for tests, selected by `AUDIO_TO_SOAP_PROVIDER`. To swap the model (or split STT and LLM again), add a class implementing the Protocol — no caller changes.

## Auth flow

1. Mobile signs in with Firebase Auth (email/password).
2. Mobile obtains an ID token, sends it as `Authorization: Bearer <token>` on every backend request.
3. FastAPI middleware verifies the token with the Firebase Admin SDK.
4. The verified token's custom claim `clinicId` becomes the security boundary for all reads/writes.

The backend never trusts the client for `clinicId` or `uid` — it reads them from the verified token only.

## Data ownership

Top-level: `clinics/{clinicId}`. Everything else (doctors, patients, recordings, SOAP notes, audit) is nested under a clinic. Firestore rules check `request.auth.token.clinicId == clinicId`. Storage rules mirror that.

The SOAP schema lives in `backend/app/models/soap.py`.

## Pipeline status machine

A `recording` document moves through:

```
uploaded → transcribed → structured → completed
                          ↘ failed (with step + code, NO PHI)
```

Each step is idempotent and individually retryable so a failure in (e.g.) PDF generation doesn't force re-recording.
