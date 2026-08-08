#!/usr/bin/env bash
# One-time: create the GCP service account that Cloud Run runs as and grant
# it the IAM roles the backend needs. No JSON key download — Cloud Run uses
# the SA's identity automatically.
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd gcloud

log "Enabling required APIs (idempotent)…"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  aiplatform.googleapis.com \
  storage.googleapis.com \
  firestore.googleapis.com \
  --project "${PROJECT_ID}"

log "Granting Cloud Build SA permission to push to Artifact Registry…"
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
CLOUDBUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# Cloud Build now uses the project's default Compute SA by default. Grant it
# the writer role on our repo. (Already implicit in newer projects, but
# making it explicit prevents surprises.)
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  --quiet >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/logging.logWriter" \
  --condition=None \
  --quiet >/dev/null

log "Creating service account ${GSA_EMAIL}…"
if gcloud iam service-accounts describe "${GSA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  log "  already exists, skipping"
else
  gcloud iam service-accounts create "${GSA_NAME}" \
    --display-name="SoapNotesAi backend (Cloud Run runtime)" \
    --project "${PROJECT_ID}"
  # IAM is eventually consistent; wait until describe succeeds.
  for i in {1..20}; do
    sleep 2
    if gcloud iam service-accounts describe "${GSA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
      log "  visible after $((i * 2))s"
      break
    fi
  done
fi

log "Granting IAM roles…"
roles=(
  "roles/datastore.user"                # Firestore read/write
  "roles/firebaseauth.admin"            # verify ID tokens + set custom claims
  "roles/storage.objectAdmin"           # GCS read/write for audio
  "roles/aiplatform.user"               # Vertex AI inference
  "roles/logging.logWriter"             # structured logs
  "roles/monitoring.metricWriter"       # metrics
)
for role in "${roles[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${GSA_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --quiet >/dev/null
done
log "  granted: ${roles[*]}"
log "Done."
