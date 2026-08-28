#!/usr/bin/env bash
#
# Google Cloud setup for the AAC backend.
#
# Idempotent: safe to re-run. Every step checks before it changes anything.
#
#   npm run setup:gcp                              # report state, grant secrets
#   TURN_SECRET_NAME=turnSharedSecret npm run setup:gcp
#   USE_GCS_MODELS=1 npm run setup:gcp             # the Cloud Storage alternative
#
# Model weights are served from Firebase Hosting, not Cloud Storage — see the
# note in the GCS section below for why. That part of this script is kept for
# organisations where the bucket route is actually available.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vpx4900}"
LOCATION="${MODELS_LOCATION:-us-east4}"
BACKEND="${APPHOSTING_BACKEND:-webmcpaac}"
BUCKET="${MODELS_BUCKET:-${PROJECT_ID}-aac-models}"
CORS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/gcs-cors.json"

blue() { printf '\033[34m%s\033[0m\n' "$1"; }
green() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }

blue "Project: ${PROJECT_ID}   Backend: ${BACKEND}   Region: ${LOCATION}"
echo

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

# --- Runtime service account -------------------------------------------------

SA="${RUNTIME_SERVICE_ACCOUNT:-firebase-app-hosting-compute@${PROJECT_NUMBER}.iam.gserviceaccount.com}"
if gcloud iam service-accounts describe "${SA}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  green "Runtime service account: ${SA}"
else
  warn "Could not confirm ${SA} exists. Override with RUNTIME_SERVICE_ACCOUNT=<email>."
fi

# --- Secret Manager access ---------------------------------------------------
#
# TURN credentials live in Secret Manager and are referenced by name from
# apphosting.yaml. The value never appears in this repository, in the client
# bundle, or in a shell history.

if [[ -n "${TURN_SECRET_NAME:-}" ]]; then
  if gcloud secrets describe "${TURN_SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    blue "Granting ${SA} read access to secret '${TURN_SECRET_NAME}'…"
    gcloud secrets add-iam-policy-binding "${TURN_SECRET_NAME}" \
      --member="serviceAccount:${SA}" \
      --role=roles/secretmanager.secretAccessor \
      --project="${PROJECT_ID}" >/dev/null
    green "Secret access granted."
  else
    warn "Secret '${TURN_SECRET_NAME}' does not exist yet. Create it first:"
    warn "  gcloud secrets create ${TURN_SECRET_NAME} --project=${PROJECT_ID}"
    warn "  printf '%s' 'THE-VALUE' | gcloud secrets versions add ${TURN_SECRET_NAME} --data-file=- --project=${PROJECT_ID}"
  fi
else
  warn "TURN_SECRET_NAME not set — skipping the Secret Manager grant."
fi

# --- Cloud Storage models (alternative) --------------------------------------
#
# Not the deployed path. A bucket has to be world-readable for the browser to
# load models from it, which means granting `allUsers`. Organisations that
# enforce Domain Restricted Sharing (constraints/iam.allowedPolicyMemberDomains)
# cannot do that, and the failure is a bare HTTP 412 that explains nothing.
#
# Cloud Storage also cannot set Cross-Origin-Resource-Policy on objects, so a
# bucket origin forces COEP down to `credentialless` and costs Safari its
# cross-origin isolation. Firebase Hosting can set the header, which is why the
# models live there. See firebase.json.

if [[ "${USE_GCS_MODELS:-}" == "1" ]]; then
  echo
  blue "Cloud Storage model hosting (alternative path)…"

  if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    green "Bucket gs://${BUCKET} already exists."
  else
    gcloud storage buckets create "gs://${BUCKET}" \
      --project="${PROJECT_ID}" --location="${LOCATION}" \
      --uniform-bucket-level-access --no-public-access-prevention
    green "Bucket created."
  fi

  gcloud storage buckets update "gs://${BUCKET}" --cors-file="${CORS_FILE}" --project="${PROJECT_ID}"
  green "CORS applied from gcs-cors.json."

  if gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member=allUsers --role=roles/storage.objectViewer --project="${PROJECT_ID}" 2>/dev/null; then
    green "Public read granted."
    echo
    echo "  MODELS_BUCKET=${BUCKET} npm run upload:models"
    echo "  Then set VITE_SHERPA_*_BASE to https://storage.googleapis.com/${BUCKET}/<bundle>"
    echo "  and COEP_MODE=credentialless — GCS cannot send Cross-Origin-Resource-Policy."
  else
    warn "Public read refused. This organisation restricts IAM members by domain,"
    warn "so allUsers cannot be granted. Use the Firebase Hosting path instead:"
    warn "  firebase deploy --only hosting:models"
  fi
fi

echo
green "Done."
