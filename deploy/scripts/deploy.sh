#!/usr/bin/env bash
# Deploy the backend to Cloud Run.
#
#   ./deploy.sh                 # build + push + deploy (one command)
#   SKIP_BUILD=1 ./deploy.sh    # redeploy last image (config-only change)
#
# What this gives you:
#   - HTTPS URL at https://soapnotesai-backend-<hash>-uc.a.run.app
#   - Auto-scaling 0 -> MAX_INSTANCES
#   - Pay only while requests are in flight
#   - Per-revision rollback in one command
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd gcloud

# Build + push first unless asked to skip.
if [[ -z "${SKIP_BUILD:-}" ]]; then
  log "Building + pushing fresh image…"
  ./03-build-and-push.sh
  IMAGE_TAG=$(cat /tmp/soapnotesai-last-image-tag 2>/dev/null || echo "")
  : "${IMAGE_TAG:?03-build-and-push.sh did not produce a tag}"
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"
log "Deploying ${IMAGE_URI}"

# Load non-secret env from the configmap-style file so we keep one source of truth.
# (Same idea as K8s ConfigMap but read by gcloud.)
ENV_FILE=$(mktemp)
trap 'rm -f "${ENV_FILE}"' EXIT
cat >"${ENV_FILE}" <<EOF
APP_ENV: production
LOG_LEVEL: INFO
FIREBASE_PROJECT_ID: soapnotesai-dev-f7e79
FIREBASE_STORAGE_BUCKET: soapnotesai-dev-f7e79.firebasestorage.app
VERTEX_PROJECT_ID: project-72f9077d-3f41-4022-9b4
VERTEX_LOCATION: us-central1
VERTEX_MODEL: gemini-2.5-flash
AUDIO_TO_SOAP_PROVIDER: vertex_gemini
MAX_UPLOAD_BYTES: "104857600"
MAX_AUDIO_DURATION_MS: "300000"
CORS_ALLOW_ORIGINS: "http://localhost:8081,http://localhost:19006,https://soapnotesai-dev-f7e79.web.app,https://soapnotesai-dev-f7e79.firebaseapp.com,https://soapnotesai.web.app,https://soapnotesai.web.app"
GRPC_DNS_RESOLVER: native
EOF

# Tag each revision with a compact identifier we can canary / rollback by.
# Cloud Run caps service-name + tag at 46 chars; "soapnotesai-backend" is 19,
# so tag has ~26 chars to play with. Use vYYMMDD-HHMMSS (13 chars).
REVISION_TAG="v$(date -u +%y%m%d-%H%M%S)"

log "Service: ${SERVICE_NAME}"
log "Revision tag: ${REVISION_TAG}"

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE_URI}" \
  --service-account "${GSA_EMAIL}" \
  --env-vars-file "${ENV_FILE}" \
  --memory "${MEMORY}" \
  --cpu "${CPU}" \
  --concurrency "${CONCURRENCY}" \
  --min-instances "${MIN_INSTANCES}" \
  --max-instances "${MAX_INSTANCES}" \
  --timeout "${TIMEOUT}" \
  --port 8080 \
  --allow-unauthenticated \
  --tag "${REVISION_TAG}" \
  --quiet

URL=$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')
log "Done."
echo
log "Public URL: ${URL}"
log "Health:     ${URL}/health"
log "Docs:       ${URL}/v1/docs"
echo
log "Update mobile/.env to:"
echo "    EXPO_PUBLIC_API_BASE_URL=${URL}"
