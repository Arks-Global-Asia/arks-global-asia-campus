#!/usr/bin/env bash
# Run in Azure Cloud Shell (Bash). Creates billable resources in your subscription.
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")"
SUBSCRIPTION_ID=${SUBSCRIPTION_ID:-a23b413f-dbe1-4a62-a9f9-62a6327fae00}
GOOGLE_PROJECT_ID=${GOOGLE_PROJECT_ID:-gen-lang-client-0246520454}
LOCATION=${LOCATION:-centralindia}
SCAN_SCHEDULE=${SCAN_SCHEDULE:-'0 30 4,21 * * *'}
RG=${RG:-rg-arks-drive-automation}
az account set --subscription "$SUBSCRIPTION_ID"
TENANT_ID=$(az account show --query tenantId -o tsv)
SUFFIX=$(printf '%s' "$SUBSCRIPTION_ID/$RG" | sha256sum | cut -c1-10)
STORAGE="arksdrive${SUFFIX}"
APP="arks-drive-${SUFFIX}"
VAULT="arks-kv-${SUFFIX}"
IDENTITY="arks-drive-reader"
printf 'Selected subscription: %s\nRegion: %s\nResource group: %s\n' "$SUBSCRIPTION_ID" "$LOCATION" "$RG"
# Check supported regions before creating resources; LOCATION can override the default.
az functionapp list-flexconsumption-locations --query '[].name' -o tsv > .locations.txt
if ! tr -d ' ' < .locations.txt | tr '[:upper:]' '[:lower:]' | grep -Fxq "$LOCATION"; then
  cat .locations.txt
  echo 'Choose a supported LOCATION from this list and rerun.' >&2
  exit 1
fi
rm .locations.txt
az group create -n "$RG" -l "$LOCATION" --tags application=arks-drive-automation -o none
for PROVIDER in Microsoft.Web Microsoft.Storage Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Insights Microsoft.OperationalInsights; do
  az provider register --namespace "$PROVIDER" --wait -o none
done
az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
az identity create -g "$RG" -n "$IDENTITY" -l "$LOCATION" -o none
MI_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query id -o tsv)
MI_CLIENT=$(az identity show -g "$RG" -n "$IDENTITY" --query clientId -o tsv)
MI_OBJECT=$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv)
az keyvault create -g "$RG" -n "$VAULT" -l "$LOCATION" --enable-rbac-authorization true -o none
VAULT_ID=$(az keyvault show -g "$RG" -n "$VAULT" --query id -o tsv)
az role assignment create --assignee-object-id "$MI_OBJECT" --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets User' --scope "$VAULT_ID" -o none
# The signed-in operator needs secret-write permission for the credential handoff.
OPERATOR_ID=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --assignee-object-id "$OPERATOR_ID" --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope "$VAULT_ID" -o none
if ! az functionapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  az functionapp create -g "$RG" -n "$APP" --storage-account "$STORAGE" \
    --flexconsumption-location "$LOCATION" --runtime python --runtime-version 3.12 \
    --instance-memory 2048 --maximum-instance-count 40 --assign-identity "$MI_ID" -o none
fi
APP_ID=$(az functionapp show -g "$RG" -n "$APP" --query id -o tsv)
az resource update --ids "$APP_ID" --set properties.keyVaultReferenceIdentity="$MI_ID" properties.httpsOnly=true -o none
az functionapp config appsettings set -g "$RG" -n "$APP" --settings \
  'AzureWebJobs.dispatch_batches.Disabled=true' 'AzureWebJobs.scan_batch.Disabled=true' \
  "SCAN_SCHEDULE=$SCAN_SCHEDULE" "AZURE_CLIENT_ID=$MI_CLIENT" \
  "ARKS_HOST_TOKEN=@Microsoft.KeyVault(SecretUri=https://${VAULT}.vault.azure.net/secrets/arks-host-token/)" \
  "ARKS_IMPORTER_TOKEN=@Microsoft.KeyVault(SecretUri=https://${VAULT}.vault.azure.net/secrets/arks-importer-token/)" -o none
# Azure CLI resolves the account key internally; it never appears in shell arguments.
az storage container create --account-name "$STORAGE" --name arks-scan-cursors --auth-mode key -o none
az storage queue create --account-name "$STORAGE" --name arks-drive-scans --auth-mode key -o none
az storage queue create --account-name "$STORAGE" --name arks-engine-jobs --auth-mode key -o none

# Entra application represents the audience, not a client secret/password.
DISPLAY_NAME="arks-google-federation-${SUFFIX}"
APP_COUNT=$(az ad app list --display-name "$DISPLAY_NAME" --query 'length(@)' -o tsv)
if [ "$APP_COUNT" = 0 ]; then
  ENTRA_APP=$(az ad app create --display-name "$DISPLAY_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
elif [ "$APP_COUNT" = 1 ]; then
  ENTRA_APP=$(az ad app list --display-name "$DISPLAY_NAME" --query '[0].appId' -o tsv)
else
  echo 'Multiple matching Entra apps; resolve the duplicate before continuing.' >&2; exit 1
fi
az ad app update --id "$ENTRA_APP" --identifier-uris "api://${ENTRA_APP}"
ENTRA_OBJECT=$(az ad app show --id "$ENTRA_APP" --query id -o tsv)
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/${ENTRA_OBJECT}" --body '{"api":{"requestedAccessTokenVersion":1}}' -o none
if ! az ad sp show --id "$ENTRA_APP" -o none 2>/dev/null; then
  az ad sp create --id "$ENTRA_APP" -o none
fi
export SUBSCRIPTION_ID GOOGLE_PROJECT_ID LOCATION RG STORAGE APP VAULT TENANT_ID MI_ID MI_CLIENT MI_OBJECT ENTRA_APP
python3 - <<'PY'
import json, os
keys = 'SUBSCRIPTION_ID GOOGLE_PROJECT_ID LOCATION RG STORAGE APP VAULT TENANT_ID MI_ID MI_CLIENT MI_OBJECT ENTRA_APP'.split()
with open('azure-config.json', 'w') as f:
    json.dump({k: os.environ[k] for k in keys}, f, indent=2)
print('Created azure-config.json (resource IDs only). Both functions remain disabled until configuration and verification.')
PY
