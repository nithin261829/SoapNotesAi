#!/usr/bin/env bash
# Build the backend image on Cloud Build (no local Docker required) and push
# it to Artifact Registry.
#
# Tag scheme:  <app-version>-<utc-timestamp>-<git-sha>
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd gcloud

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || { cd ../.. && pwd; })"
CONTEXT="${REPO_ROOT}/backend"

# Pull app version from app/version.py (single source of truth).
APP_VERSION=$(grep -E '^__version__\s*=' "${CONTEXT}/app/version.py" | sed -E 's/.*"([^"]+)".*/\1/')
: "${APP_VERSION:?could not parse __version__ from app/version.py}"

GIT_SHA=$(cd "${REPO_ROOT}" && git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")
BUILD_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -u +%Y%m%d-%H%M%S)

IMAGE_TAG="${APP_VERSION}-${STAMP}-${GIT_SHA}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"
LATEST_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:latest"

log "App version: ${APP_VERSION}"
log "Git SHA:     ${GIT_SHA}"
log "Build time:  ${BUILD_TS}"
log "Image tag:   ${IMAGE_TAG}"
log "Image URI:   ${IMAGE_URI}"
log "Building on Cloud Build (no local Docker needed)…"

# Submit from repo root so the Dockerfile + backend/ are both in the upload.
# .gcloudignore (auto-created on first run) keeps it small.
cd "${REPO_ROOT}"

# gcloud's --substitutions list is comma-separated. Cloud Build rejects
# substitutions that aren't referenced in the YAML, so only the keys the
# YAML actually uses appear here.
SUBS="_GIT_SHA=${GIT_SHA}"
SUBS+=",_BUILD_TS=${BUILD_TS}"
SUBS+=",_IMAGE_TAG=${IMAGE_TAG}"
SUBS+=",_IMAGE_URI=${IMAGE_URI}"
SUBS+=",_LATEST_URI=${LATEST_URI}"

gcloud builds submit \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --config=deploy/docker/cloudbuild.yaml \
  --substitutions="${SUBS}" \
  .

log "Built + pushed:"
echo "    ${IMAGE_URI}"
echo "    ${LATEST_URI}"

# Persist the tag so deploy.sh can pick it up.
echo "${IMAGE_TAG}" > /tmp/soapnotesai-last-image-tag
echo
log "To deploy this exact image:"
echo "    IMAGE_TAG=${IMAGE_TAG} ./deploy/scripts/deploy.sh"
