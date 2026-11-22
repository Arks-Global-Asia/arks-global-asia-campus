#!/usr/bin/env bash
set -euo pipefail
# Run from signed-in Azure Cloud Shell Bash in Default Directory.
# Creates the web-host resource only; application deployment follows separately.
ARKS_SUBSCRIPTION='a23b413f-dbe1-4a62-a9f9-62a6327fae00'
ARKS_GROUP='rg-arks-studentportal'
ARKS_REGION='centralindia'
ARKS_WEB_REGION='eastasia'
ARKS_WEB='arks-studentportal'
az account set --subscription "$ARKS_SUBSCRIPTION"
az group create --name "$ARKS_GROUP" --location "$ARKS_REGION" --output none
# Static Web Apps supports a subset of regions; use East Asia for app metadata.
az staticwebapp create --name "$ARKS_WEB" --resource-group "$ARKS_GROUP" --location "$ARKS_WEB_REGION" --sku Free --output none
az staticwebapp show --name "$ARKS_WEB" --resource-group "$ARKS_GROUP" --query '{name:name,hostname:defaultHostname,plan:sku.name}' --output json
