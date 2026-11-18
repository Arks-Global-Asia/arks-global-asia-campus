# Azure portal activation — release 1.1

The repository now includes a managed Azure Functions API, PostgreSQL adapter/schema, private Blob adapter and Entra authorization-code/PKCE flow. The Azure GitHub workflow deploys the API together with the Vite client. The existing Sites/ChatGPT sign-in fallback has been removed from the frontend. This implements the migration runtime; it does not create your cloud secrets or copy existing Sites data merely by pushing code.

## 1. Wait for the GitHub deployment

Open repository Actions > Azure Static Web Apps CI/CD and confirm the deployment succeeds. The workflow now deploys `api/` alongside `dist/client`. No deployment token needs to be copied into source; it reuses the existing GitHub secret for black-water-04f865700.

The API reports JSON even while unconfigured. Visit:

`https://black-water-04f865700.5.azurestaticapps.net/api/health`

Before setup, a JSON 503 with `configured:false` is expected. Receiving HTML or a platform 404 means the managed API has not deployed. Do not add `/api/*` to the SPA fallback to hide that error.

## 2. Add the preview callback to Entra

Switch to external tenant `0c218ee7-11fe-4714-962d-ba5efb884bc2` > App registrations > Arks Campus Portal (`38f7e4ae-291c-4aa3-b8b0-72a28242e01f`) > Authentication > Web.

Keep the intended production callback and add the preview callback exactly:

```
https://studentportal.arksglobalasia.cloud/api/auth/entra/callback
https://black-water-04f865700.5.azurestaticapps.net/api/auth/entra/callback
```

The active `APP_ORIGIN` must match the address students actually open. The setup script defaults to the deployed Azure hostname. Use `--origin https://studentportal.arksglobalasia.cloud` only after that custom domain has working DNS and HTTPS.

Confirm the Google-enabled ArksStudents user flow is associated with the app. Ensure an email attribute/claim is returned in the ID token (Token configuration / Attributes & Claims). The app uses the tenant-validated email only to redeem an explicit enrollment, then binds the stable issuer/subject; it never treats an arbitrary username as an admin identity. Under Certificates & secrets create/copy an application client-secret **value** privately. This is the Entra application's secret, distinct from the Google-provider secret. Enter it only in the hidden setup prompt. Do not send it in chat or put it into GitHub.

## 3. Provision the backend from Azure Cloud Shell Bash

Use Default Directory, where the existing subscription and Key Vault are visible. Clone or pull the repository:

```bash
git clone https://github.com/Arks-Global-Asia/arks-global-asia-campus.git
cd arks-global-asia-campus
python3 azure/setup-portal.py
```

If your repository is already cloned, use `git pull` before running the script. Node.js 22+ is required for the provisioning helper. Use the Cloud Shell's Node version manager if needed; check `node --version` first.

The script asks for the existing PostgreSQL administrator login/password, Entra client secret, institute administrator email and a new campus admin password of at least 14 characters. Passwords are hidden. The PostgreSQL administrator password is used only for provisioning and is not stored or sent to the browser. All courses and batches share this one application user base; individual students have one profile and multiple enrollment records. It selects the existing Static Web App; use `--app-name NAME --resource-group GROUP` if multiple sites exist.

It creates/reuses:

- The central `arks_global_institutes` database on your existing Azure PostgreSQL Flexible Server `pg-arksglobal-asia.postgres.database.azure.com`. No new SQL Server or PostgreSQL server is provisioned. Existing server compute, storage and connections are shared and billed under that server's plan.
- A private Standard LRS StorageV2 account and `campus-private` container.
- All 26 campus tables, indexes and foreign keys in a dedicated `arks` PostgreSQL schema, from the reviewed migration schema. Score columns use decimal marks; monetary amounts remain integer minor units.
- A dedicated `arks_campus_api` PostgreSQL login limited to connecting to the selected database and reading/writing campus schema tables. The runtime does not receive the PostgreSQL administrator password.
- A salted/hashed campus administrator password and explicit owner setting. Anonymous first visitors cannot claim owner in the Entra deployment.
- Server-only Static Web App settings. The dedicated PostgreSQL runtime password and the Entra secret are backed up in the existing Key Vault; secret values are sent through stdin, not shell arguments or logs. The Free managed API uses encrypted app settings for its runtime credentials; it does not assume unsupported Key Vault-reference or managed-identity behavior.

The PostgreSQL firewall allows authenticated TLS connections from Azure services for the managed API. If the existing PostgreSQL server is private-network only, the setup stops instead of exposing it: Free managed Functions need a reachable endpoint or a different backend/network plan. More restrictive network design can be introduced with an appropriate paid/private-network topology. Blob containers remain anonymous-access disabled.

Only nonsecret resource IDs are written to `azure/portal-azure-config.json`, which is ignored by Git. Keep a backup outside ephemeral Cloud Shell sessions. No cloud provisioning identity is connected to the code-authoring environment, so this signed-in operator step is required.

## 4. Sign in and configure enrollment

Reload `/api/health`; `ok:true` confirms required settings are present (not a comprehensive health probe). Open the site. Use the administrator email/password you just configured. The first admin bootstrap creates the editable starter course/batch, without fictional payments or student progress.

Create/review the real batch, fees and student invitations/access groups. A Google user authenticating through Entra receives course access only after the portal matches enrollment. Merely registering with Entra does not grant admin privileges. Existing administrators are never linked to a federated identity solely because an email matches; subject linking is explicit, and password login is available.

## 5. Migrate existing data before automation cutover

Existing Sites/D1/R2 records and private files are not automatically transferred. Preserve original user/batch/content IDs, fees, payment references, question snapshots, import revision keys and file IDs when migrating. Entra is the identity provider; PostgreSQL is the authoritative campus profile/role/enrollment store. Do not create one database or duplicate student account per batch. Keep the old portal available until you have backed up and verified those records. The PostgreSQL schema initializer is non-destructive for tables it created, but it is an initial schema tool, not a general incremental database migration framework.

Export the old portal data using authorized platform/admin access, transform/load it into PostgreSQL in dependency order, and copy R2 objects into the private blob container using the same IDs. Review owner and identity linking rather than replacing stable IDs. Do not attach production exports or passwords to the public GitHub repository. A fresh campus can instead be configured manually, but do not treat that as a migration of historical records.

## 6. Connect the existing Drive/AI worker deliberately

The setup script does not silently redirect your existing Drive worker away from the old portal. After real batch/source mappings and history are migrated/configured:

1. Restore your existing `azure/azure-config.json` and `azure/google-config.json` in Cloud Shell if needed.
2. Run `python3 azure/upgrade-engine.py` to deploy the updated worker (including configurable portal origin).
3. Run `python3 azure/connect-portal-worker.py`. It refuses to connect an empty Azure campus with no enabled source, obtains a function-specific dispatch key without displaying it, preserves other app settings, switches the worker origin and leaves the timer disabled.
4. Run `cd azure`, then `python3 operate.py smoke` and verify completed Azure scans.
5. Run `python3 operate.py enable` only after smoke succeeds. The schedule is 03:00 and 10:00 IST (`0 30 4,21 * * *` UTC).

The API, job engine and worker now all support the same-origin Azure deployment. DeepSeek, Drive permissions, optional Workspace groups and Shared Drive destination must still be configured in their respective services. They are not replaced by Entra authentication.

## 7. Verify before opening enrollment

Test the administrator login; an enrolled Gmail student; an unenrolled account; disabled account; foreign batch access; private PDF and presentation download; lab submit/review; a 100-mark mixed assessment with one attempt and final written grading; result PDF; immediate Sync Up and a scheduled scan. Verify narrow Android layouts/PWA installation and actual Google sharing for recording links.

Backend errors are returned as safe JSON; secrets and provider bodies are not sent to the browser. The API strips the old Sites identity headers. Sensitive records use no-store. Hashed frontend assets cache for one year; the HTML and service worker revalidate.

## Troubleshooting

| Symptom | Check |
|---|---|
| HTML returned by `/api/bootstrap` | GitHub deployment must include `api_location: api`; inspect API build/deploy logs |
| Service setup message | Run setup; check server-only app settings, PostgreSQL schema and Blob configuration |
| Entra redirect mismatch | Add the exact active `APP_ORIGIN` callback under the external tenant's Web app |
| Entra token accepted but enrollment denied | Ensure the email claim is available and an invitation/group matches the account |
| PostgreSQL connection error | Confirm the existing server is running, TLS trust, firewall, role password, database name and the dedicated schema grants |
| No source scans after migration | Configure/migrate enabled sources, deploy worker upgrade, run explicit worker connection and smoke |
| Former ChatGPT URL bookmarked | The Azure routing configuration redirects the obsolete sign-in path to the campus home |

## References

- https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions
- https://learn.microsoft.com/en-us/azure/static-web-apps/configuration
- https://learn.microsoft.com/en-us/azure/static-web-apps/application-settings
- https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/overview
- https://learn.microsoft.com/en-us/entra/external-id/customers/concept-supported-features-customers
