# SoapNotesAi — Privacy Policy (DRAFT — review before publishing)

_Last updated: 9 August 2026_

SoapNotesAi ("the App") is a clinical documentation tool by SoapNotesAi that helps
licensed healthcare professionals convert dictated patient encounters into
structured SOAP notes. This policy explains what data the App handles and how.

> **DRAFT NOTE (remove before publish):** Both app stores require a hosted
> privacy-policy URL. Host this page at `https://example.com/privacy` (or
> similar) and review with legal counsel — the App processes health data, so
> obligations under India's DPDP Act 2023 (and any applicable local law) apply.

## Who uses the App

The App is intended for verified healthcare professionals and their clinic
staff. Patients do not use the App directly; their information is entered by
their treating clinician.

## Data we collect

**Account data (from the clinician):** name, email address, phone number,
professional credentials, medical-council registration details, and uploaded
registration proof (used solely for identity verification).

**Clinical data (entered by the clinician):** patient name, age, sex, phone
number, dictated audio recordings of encounters, transcripts, and structured
SOAP notes derived from them.

**Payment data:** subscription and wallet transactions are processed by
Razorpay. The App never sees or stores card, UPI, or bank credentials — only
payment references (order and payment IDs) and amounts.

**Device data:** a push-notification token (if notifications are enabled) and
basic diagnostic logs (which never contain clinical content).

## How data is processed

- Audio dictations are transcribed and structured using Google Cloud's Vertex
  AI. Audio and notes are transmitted over encrypted connections (TLS) and
  stored encrypted at rest in Google Cloud (Firestore and Cloud Storage).
- Generated PDFs are rendered on demand and are not stored on our servers.
- The App deletes local copies of audio and PDFs from the device once they are
  safely uploaded or shared — clinical data lives in the cloud, not on phones.

## Data sharing

We do not sell or rent any data. Data is shared only with the processors
required to run the service: Google Cloud (hosting, storage, AI processing)
and Razorpay (payments). Clinical data is never used to train AI models.

## Multi-clinic isolation

Each client organization's data is stored under its own isolated identifier.
Staff accounts see only the clinics they belong to, with restricted
permissions.

## Retention

Clinical records are retained according to the clinic's subscription plan's
cloud-backup window, and can be exported (Excel) or deleted on request by the
organization owner.

## Security

Encryption in transit and at rest; role-based access control; OTP login
verification; audit logging of administrative actions; least-privilege service
accounts.

## Your rights

Organization owners may request export or deletion of their organization's
data by contacting us. Patients should direct requests to their treating
clinic, which controls their records.

## Contact

SoapNotesAi — support: you@example.com
