#!/usr/bin/env bash
# Tail Cloud Run logs.
#   ./logs.sh                # recent + follow
#   ./logs.sh --no-follow    # one snapshot, then exit
#   ./logs.sh "ERROR"        # filter by text
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

FOLLOW="--follow"
FILTER=""
for arg in "$@"; do
  case "$arg" in
    --no-follow) FOLLOW="" ;;
    *) FILTER="${arg}" ;;
  esac
done

# `gcloud beta` needed for --follow (streams as logs arrive).
LOG_QUERY="resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}"
if [[ -n "${FILTER}" ]]; then
  LOG_QUERY="${LOG_QUERY} AND (textPayload:\"${FILTER}\" OR jsonPayload.message:\"${FILTER}\")"
fi

if [[ -n "${FOLLOW}" ]]; then
  exec gcloud beta logging tail "${LOG_QUERY}" \
    --project "${PROJECT_ID}" \
    --format='value(timestamp, severity, textPayload, jsonPayload.message)'
else
  exec gcloud logging read "${LOG_QUERY}" \
    --project "${PROJECT_ID}" \
    --limit=100 \
    --format='value(timestamp, severity, textPayload, jsonPayload.message)'
fi
