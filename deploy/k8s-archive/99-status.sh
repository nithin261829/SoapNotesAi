#!/usr/bin/env bash
# At-a-glance status check after a deploy.
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

log "Pods:"
kubectl -n "${NAMESPACE}" get pods -o wide

log "Service:"
kubectl -n "${NAMESPACE}" get svc backend

log "Ingress (look for ADDRESS):"
kubectl -n "${NAMESPACE}" get ingress backend

log "Managed cert (look for status=Active):"
kubectl -n "${NAMESPACE}" get managedcertificate backend-cert -o jsonpath='{.status.certificateStatus}' 2>/dev/null
echo

log "HPA:"
kubectl -n "${NAMESPACE}" get hpa backend

log "Recent logs (last 50 lines):"
kubectl -n "${NAMESPACE}" logs --tail=50 -l app=backend
