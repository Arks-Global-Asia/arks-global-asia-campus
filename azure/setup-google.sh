#!/usr/bin/env bash
# Run in Google Cloud Shell with azure-config.json beside this script.
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")"
read_config() { python3 -c 'import json,sys; print(json.load(open("azure-config.json"))[sys.argv[1]])' "$1"; }
PROJECT=$(read_config GOOGLE_PROJECT_ID)
TENANT=$(read_config TENANT_ID)
MI_OBJECT=$(read_config MI_OBJECT)
ENTRA_APP=$(read_config ENTRA_APP)
POOL=arks-azure
PROVIDER=azure-managed-identity
SA_NAME=arks-drive-reader
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
gcloud services enable drive.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT"
if ! gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name='Arks read-only Drive importer' --project="$PROJECT"
fi
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name='Arks Azure workers' --project="$PROJECT"
fi
ACTION=create-oidc
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  ACTION=update-oidc
fi
gcloud iam workload-identity-pools providers "$ACTION" "$PROVIDER" \
  --workload-identity-pool="$POOL" --location=global --project="$PROJECT" \
  --issuer-uri="https://sts.windows.net/${TENANT}/" \
  --allowed-audiences="api://${ENTRA_APP}" \
  --attribute-mapping='google.subject=assertion.oid' \
  --attribute-condition="assertion.oid == '${MI_OBJECT}' && assertion.tid == '${TENANT}'"
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/${NUMBER}/locations/global/workloadIdentityPools/${POOL}/subject/${MI_OBJECT}"
export NUMBER PROJECT POOL PROVIDER SA ENTRA_APP
python3 - <<'PY'
import json, os
e=os.environ
config={
 'GOOGLE_SERVICE_ACCOUNT': e['SA'],
 'GOOGLE_WIF_AUDIENCE': f"//iam.googleapis.com/projects/{e['NUMBER']}/locations/global/workloadIdentityPools/{e['POOL']}/providers/{e['PROVIDER']}",
 'AZURE_FEDERATION_AUDIENCE': 'api://' + e['ENTRA_APP'],
}
with open('google-config.json','w') as f: json.dump(config,f,indent=2)
print('Created google-config.json (public identifiers only).')
print('Share the batch folder with Viewer access to: ' + e['SA'])
PY
