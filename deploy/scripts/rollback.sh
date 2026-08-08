#!/usr/bin/env bash
# Roll all production traffic back to the previous revision.
#   ./rollback.sh                # roll to second-newest
#   ./rollback.sh REVISION_NAME  # roll to a specific named revision
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

if [[ -n "${1:-}" ]]; then
  TARGET="$1"
else
  TARGET=$(gcloud run revisions list \
    --service "${SERVICE_NAME}" \
    --project "${PROJECT_ID}" --region "${REGION}" \
    --format='value(metadata.name)' --limit=2 | tail -n1)
fi
: "${TARGET:?could not pick a target revision}"

log "Rolling all traffic to: ${TARGET}"
gcloud run services update-traffic "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --to-revisions "${TARGET}=100"

./status.sh
