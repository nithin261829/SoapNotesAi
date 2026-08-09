#!/usr/bin/env bash
# Central source of project / cluster / region constants. Every other script
# in this folder sources this first. Override any value by exporting it
# before running the script:  PROJECT_ID=foo ./05-deploy.sh
set -euo pipefail

# ─── GCP ──────────────────────────────────────────────────────────
: "${PROJECT_ID:=soapnotesai-dev-f7e79}"
: "${REGION:=us-central1}"

# ─── Artifact Registry (Docker image host) ────────────────────────
: "${REPO_NAME:=soapnotesai}"
: "${IMAGE_NAME:=backend}"
: "${IMAGE_TAG:=$(date -u +%Y%m%d-%H%M%S)}"
: "${IMAGE_URI:=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}}"

# ─── Cloud Run ────────────────────────────────────────────────────
: "${SERVICE_NAME:=soapnotesai-backend}"
: "${GSA_NAME:=soapnotesai-backend}"
: "${GSA_EMAIL:=${GSA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com}"
# Concurrency per instance (FastAPI handles many in-flight requests fine;
# 80 is the Cloud Run default and a sensible starting point).
: "${CONCURRENCY:=80}"
: "${MIN_INSTANCES:=1}"   # keep 1 warm — no cold starts (costs ~Rs.500-800/mo)
: "${MAX_INSTANCES:=10}"  # safety cap so a runaway can't bankrupt us
: "${MEMORY:=1Gi}"
: "${CPU:=1}"
: "${TIMEOUT:=300}"       # request timeout in seconds (AI calls can be slow)

# ─── Helpers ──────────────────────────────────────────────────────
log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}
