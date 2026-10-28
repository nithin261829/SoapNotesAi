# Compliance notes

This file is the canonical inventory of where PHI leaves the system and which third parties touch it. Update it when you add or remove a provider.

## v1 status

**Synthetic / test data only.** No real PHI may be loaded into this system until every checkbox in the README's HIPAA section is checked.

## Where PHI leaves the system

| Service | What is sent | BAA needed | HIPAA-eligible? (verify) | Notes |
|---|---|---|---|---|
| Cloud Storage for Firebase | Raw audio (`.m4a`), generated PDFs | Yes | Verify under your Google Cloud BAA | Bucket must be non-public; enforced by Storage rules |
| Cloud Firestore | Patient metadata, transcripts, structured SOAP notes, audit events | Yes | Verify under your Google Cloud BAA | All under `clinics/{clinicId}/...` path |
| Firebase Authentication | Email + auth tokens (no clinical data) | Yes | Verify under your Google Cloud BAA | |
| Vertex AI (Gemini) | Raw audio bytes (returns transcript + SOAP) | Yes | Verify region + product-specific BAA terms | The audio is the highest-PHI payload — confirm Vertex AI generative AI is BAA-covered in your project's region |

## Where PHI must NOT appear

- Application logs (FastAPI access log, uvicorn stderr)
- Error messages returned to the client (`{step, code}` only — no transcript or patient name in error payloads)
- Audit events (`actorUid`, action, target IDs only — no clinical content)
- Analytics, crash reports, performance monitoring
- CI logs

The audit collection (`clinics/{clinicId}/audit`) is intentionally narrow — see `backend/app/models/audit.py`.

## Network egress

| Egress | Destination |
|---|---|
| Mobile → backend | TLS to your FastAPI host |
| Backend → Firestore | TLS to `*.googleapis.com` |
| Backend → Cloud Storage | TLS to `*.googleapis.com` |
| Backend → STT | TLS to `speech.googleapis.com` |
| Backend → Vertex AI | TLS to `*-aiplatform.googleapis.com` |

No egress to non-Google services in v1.

## Provider swap checklist

If you replace any default Google provider:

1. Implement the corresponding `Protocol` in `backend/app/interfaces/`.
2. Wire it in `backend/app/config.py`.
3. Add the provider here with its BAA / hosting status.
4. Update README's HIPAA checklist.
