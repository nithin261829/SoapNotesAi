#!/usr/bin/env bash
# One-time: create a GCP service account, grant it the IAM roles the backend
# needs, and bind it to the Kubernetes service account via Workload Identity.
# Result: pods run as a Google identity that can read Firestore, write Storage,
# and call Vertex AI — without ever holding a JSON key.
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd gcloud

log "Creating GCP service account ${GSA_EMAIL}…"
if gcloud iam service-accounts describe "${GSA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  log "  already exists, skipping"
else
  gcloud iam service-accounts create "${GSA_NAME}" \
    --display-name="SoapNotesAi backend (K8s pod identity)" \
    --project "${PROJECT_ID}"
  # IAM is eventually consistent — the SA can take ~10s to be visible to
  # later add-iam-policy-binding calls. Poll until describe succeeds.
  log "  waiting for IAM propagation…"
  for i in {1..20}; do
    sleep 2
    if gcloud iam service-accounts describe "${GSA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
      log "  visible after $((i * 2))s"
      break
    fi
  done
fi

log "Granting IAM roles to ${GSA_EMAIL}…"
# Firestore + Firebase Auth (verify ID tokens, set custom claims).
roles=(
  "roles/datastore.user"                       # Firestore read/write
  "roles/firebaseauth.admin"                   # set custom claims
  "roles/storage.objectAdmin"                  # GCS read/write for audio
  "roles/aiplatform.user"                      # Vertex AI inference
  "roles/logging.logWriter"                    # structured logs
  "roles/monitoring.metricWriter"              # metrics
)
for role in "${roles[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${GSA_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --quiet >/dev/null
done
log "  granted: ${roles[*]}"

log "Binding KSA ${NAMESPACE}/${KSA_NAME} -> GSA ${GSA_EMAIL} (Workload Identity)…"
gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[${NAMESPACE}/${KSA_NAME}]" \
  --project "${PROJECT_ID}" \
  --quiet >/dev/null

log "Done. The annotation in k8s/serviceaccount.yaml is applied at deploy time."
