#!/usr/bin/env bash
# Roll back the backend deployment to the previous revision.
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

log "Recent rollout history:"
kubectl -n "${NAMESPACE}" rollout history deploy/backend

log "Rolling back to previous revision…"
kubectl -n "${NAMESPACE}" rollout undo deploy/backend

log "Watching rollout…"
kubectl -n "${NAMESPACE}" rollout status deploy/backend --timeout=5m
