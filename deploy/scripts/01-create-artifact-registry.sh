#!/usr/bin/env bash
# One-time: create the Docker registry that holds our backend images.
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd gcloud

log "Creating Artifact Registry repo ${REPO_NAME} in ${REGION}…"
if gcloud artifacts repositories describe "${REPO_NAME}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  log "  already exists, skipping"
else
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="SoapNotesAi container images" \
    --project "${PROJECT_ID}"
fi

log "Configuring local Docker to authenticate to ${REGION}-docker.pkg.dev…"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet --project "${PROJECT_ID}"

log "Done."
