#!/usr/bin/env bash
# Snapshot of the current Cloud Run service state.
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

log "Service:"
gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='table(metadata.name, status.url, status.latestReadyRevisionName, status.conditions[0].status)'

log "Recent revisions (newest first):"
gcloud run revisions list \
  --service "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='table(metadata.name, metadata.creationTimestamp, status.conditions[0].status)' \
  --limit=5

log "Active traffic split:"
gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='table(spec.traffic[].percent, spec.traffic[].revisionName, spec.traffic[].tag)'

log "Health check via public URL:"
URL=$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')
curl -sS "${URL}/health" | head -10
echo
