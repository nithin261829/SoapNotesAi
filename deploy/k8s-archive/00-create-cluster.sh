#!/usr/bin/env bash
# One-time: create the GKE Autopilot cluster + reserve the static IP.
#
# Autopilot is the right choice here: Google manages the nodes, you only pay
# for what your pods request. ~$0.04/hr for the 1-pod baseline plus the LB.
#
# Usage:  ./00-create-cluster.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

require_cmd gcloud

log "Project:  ${PROJECT_ID}"
log "Region:   ${REGION}"
log "Cluster:  ${CLUSTER_NAME}"

gcloud config set project "${PROJECT_ID}" >/dev/null

log "Enabling required GCP APIs (idempotent)…"
gcloud services enable \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  compute.googleapis.com \
  --project "${PROJECT_ID}"

log "Reserving global static IP for the ingress…"
if gcloud compute addresses describe "${STATIC_IP_NAME}" --global --project "${PROJECT_ID}" >/dev/null 2>&1; then
  log "  already exists, skipping"
else
  gcloud compute addresses create "${STATIC_IP_NAME}" --global --project "${PROJECT_ID}"
fi
RESERVED_IP=$(gcloud compute addresses describe "${STATIC_IP_NAME}" --global --project "${PROJECT_ID}" --format='value(address)')
log "  static IP: ${RESERVED_IP}"

log "Creating Autopilot cluster (this can take 5-10 min)…"
if gcloud container clusters describe "${CLUSTER_NAME}" --region "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  log "  cluster already exists, skipping"
else
  gcloud container clusters create-auto "${CLUSTER_NAME}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --release-channel=regular
fi

log "Fetching cluster credentials into your local kubeconfig…"
gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region "${REGION}" --project "${PROJECT_ID}"

log "Done. Next steps:"
echo "    1. Point DNS A record for ${DOMAIN_NAME} -> ${RESERVED_IP}"
echo "    2. Run ./01-create-artifact-registry.sh"
echo "    3. Run ./02-setup-workload-identity.sh"
echo "    4. Run ./03-build-and-push.sh"
echo "    5. Run ./05-deploy.sh"
