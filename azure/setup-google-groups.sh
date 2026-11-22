#!/usr/bin/env bash
set -euo pipefail
PROJECT=gen-lang-client-0246520454
DIRECTORY_SA="arks-directory@${PROJECT}.iam.gserviceaccount.com"
READER_SA="arks-drive-reader@${PROJECT}.iam.gserviceaccount.com"
gcloud services enable admin.googleapis.com iamcredentials.googleapis.com --project "$PROJECT"
if ! gcloud iam service-accounts describe "$DIRECTORY_SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create arks-directory --display-name 'Arks Workspace Groups' --project "$PROJECT"
fi
gcloud iam service-accounts add-iam-policy-binding "$DIRECTORY_SA" --project "$PROJECT" --member "serviceAccount:${READER_SA}" --role roles/iam.serviceAccountTokenCreator >/dev/null
printf 'Directory service account: %s\n' "$DIRECTORY_SA"
printf 'Use this OAuth client ID for Workspace domain-wide delegation:\n'
gcloud iam service-accounts describe "$DIRECTORY_SA" --project "$PROJECT" --format='value(oauth2ClientId)'
printf 'Next: follow CAMPUS-UPGRADE.md to authorize only the Directory group membership scopes. No private key was created.\n'
