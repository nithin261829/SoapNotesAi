#!/usr/bin/env bash
# Deploy the web dashboard to Firebase Hosting (https://soapnotesai.web.app).
#
#   ./deploy-web.sh          # export the Expo web build + deploy hosting
#
# What it does:
#   1. Builds the Expo app for web with the production API URL baked in
#   2. Copies the build into firebase/hosting-dist (inside the Firebase root)
#   3. Deploys to the "soapnotesai" Hosting site
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
require_cmd npx

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || { cd ../.. && pwd; })"
API_URL="${API_URL:-https://soapnotesai-backend-z66y5cnt4q-uc.a.run.app}"
SITE="${SITE:-soapnotesai}"

log "Building web bundle (API: ${API_URL})…"
cd "${REPO_ROOT}/mobile"
EXPO_PUBLIC_API_BASE_URL="${API_URL}" CI=1 npx expo export --platform web

log "Staging into firebase/hosting-dist…"
rm -rf "${REPO_ROOT}/firebase/hosting-dist"
cp -R dist "${REPO_ROOT}/firebase/hosting-dist"

log "Deploying to Firebase Hosting site '${SITE}'…"
cd "${REPO_ROOT}/firebase"
npx --yes firebase-tools deploy --only "hosting:${SITE}" --project "${PROJECT_ID}"

log "Live: https://${SITE}.web.app"
