#!/usr/bin/env bash
# Apply all K8s manifests with placeholders substituted in.
# Idempotent — safe to re-run for every release.
#
# Image to deploy:
#   - default: builds + pushes a fresh image first
#   - pinned:  IMAGE_TAG=20260612-194301 ./05-deploy.sh  (no rebuild)
#   - reuse:   SKIP_BUILD=1 ./05-deploy.sh               (use most recent tag in env.sh)
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd kubectl

if [[ -z "${SKIP_BUILD:-}" ]]; then
  log "Building + pushing a fresh image first…"
  ./03-build-and-push.sh
  # 03 writes the tag it just pushed here.
  IMAGE_TAG=$(cat /tmp/soapnotesai-last-image-tag 2>/dev/null || echo "")
  : "${IMAGE_TAG:?03-build-and-push.sh did not produce a tag}"
  IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"
fi
log "Deploying image: ${IMAGE_URI}"

# Sanity check: are we pointed at the right cluster?
CURRENT_CTX=$(kubectl config current-context 2>/dev/null || echo none)
log "kubectl context: ${CURRENT_CTX}"
if [[ "${CURRENT_CTX}" != *"${CLUSTER_NAME}"* ]]; then
  warn "Current kubectl context doesn't look like ${CLUSTER_NAME}."
  warn "Run:  gcloud container clusters get-credentials ${CLUSTER_NAME} --region ${REGION} --project ${PROJECT_ID}"
  read -r -p "Continue anyway? [y/N] " ans
  [[ "${ans}" == "y" ]] || exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || cd ../.. && pwd)"
K8S_DIR="${REPO_ROOT}/deploy/k8s"
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

log "Rendering manifests with substitutions…"
cp "${K8S_DIR}"/*.yaml "${TMP}/"
# Replace placeholder tokens (one sed pass per file).
for f in "${TMP}"/*.yaml; do
  sed -i.bak \
    -e "s|PROJECT_ID|${PROJECT_ID}|g" \
    -e "s|DOMAIN_NAME|${DOMAIN_NAME}|g" \
    -e "s|IMAGE|${IMAGE_URI//|/\\|}|g" \
    "${f}"
  rm -f "${f}.bak"
done

log "Applying manifests…"
# Order matters: namespace first, then SA, then config, then workload + ingress.
kubectl apply -f "${TMP}/namespace.yaml"
kubectl apply -f "${TMP}/serviceaccount.yaml"
kubectl apply -f "${TMP}/configmap.yaml"
kubectl apply -f "${TMP}/deployment.yaml"
kubectl apply -f "${TMP}/service.yaml"
kubectl apply -f "${TMP}/hpa.yaml"
kubectl apply -f "${TMP}/managed-certificate.yaml"
kubectl apply -f "${TMP}/ingress.yaml"

log "Waiting for rollout to settle (timeout 5m)…"
kubectl -n "${NAMESPACE}" rollout status deploy/backend --timeout=5m

log "Deployment complete."
echo
./99-status.sh
