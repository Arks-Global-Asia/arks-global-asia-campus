# Arks Global Asia Institutes — Campus

DevOps bootcamp portal for desktop web and Android as an installable PWA.

## Implementation status

The application now has two supported runtime paths:

- **Azure:** Static Web Apps client plus a managed Node.js Functions API, central PostgreSQL database, private Blob Storage and application-owned Entra External ID login (Google federation).
- **Existing Sites deployment/local development:** Worker API with D1/SQLite and R2; retained for compatibility and migration.

Azure deployment does not automatically create server settings or copy existing Sites records. Follow [Azure portal activation](azure/PORTAL-SETUP.md). The secure Cloud Shell script reuses `pg-arksglobal-asia.postgres.database.azure.com` and the central `arks_global_institutes` database; it does not create another database server. Database profiles, roles, fees and per-batch enrollments are centralized; Entra handles federated identity.

The frontend no longer directs visitors to ChatGPT sign-in. Missing APIs/settings produce a safe service/setup message. The Azure API rejects the old host identity headers. Entra login implements code flow with PKCE, state/nonce, signed-token validation and stable subject bindings; email alone cannot link an administrator account.

## Run locally

Node.js 22 or later:

```bash
npm ci
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:4173`. Local records and files live under `.local/` and are ignored by Git. Existing local databases are not automatically migrated by the local helper; back up data before resetting a local workspace.

Python 3.12 worker checks:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r azure/function/requirements.txt
python -m unittest discover -s azure/tests -v
```

## Source map

| Directory | Responsibility |
|---|---|
| `src/` | Student/admin React views and controls |
| `server/` | Role-scoped APIs, sessions, imports, job leases and private PDF results |
| `shared/` | Question validation, type-aware answers and 100-mark scoring rules |
| `db/`, `drizzle/` | SQLite schema and reviewed migrations |
| `azure/function/` | Drive scanner, workload identity, AI jobs and Function triggers |
| `azure/` | Setup, upgrade and operation scripts; local config files are excluded |
| `tests/`, `azure/tests/` | API, DOM, authorization, assessment and worker tests |
| `public/` | Branding, PWA assets and existing in-app documentation assets |

## Azure build and deployment

```bash
npm run build:azure
npm run azure:verify
```

The existing Azure workflow now deploys `dist/client` and the prebuilt `api/` managed Functions package together. It reuses your existing Static Web Apps deployment secret. Runtime values belong in server app settings/Key Vault, never GitHub source.

`azure/portal/schema.sql` is the explicit initial PostgreSQL schema. It is not run from HTTP requests. The `arks` schema isolates campus tables from other applications, and one user can enroll in multiple batches without duplicate accounts. Preserve existing IDs/history when migrating records and objects from D1/R2. No old production data is automatically overwritten.

The live Entra redirect must match `APP_ORIGIN` exactly. Configure both the Azure preview and intended custom-domain Web callbacks as documented. A cloud operator must run `python3 azure/setup-portal.py` from a signed-in Azure Cloud Shell before students can use the Azure backend. Use Node.js 22+ there.

The existing Drive/AI worker is reused. Cut it over only after source mappings/history are migrated using the dedicated connection script and smoke test. Do not point the website DNS at the automation Function App.

## Local PostgreSQL integration tests

Supply an ignored JSON file with `PORTAL_PG_HOST`, `PORTAL_PG_PORT`, `PORTAL_PG_USER`, `PORTAL_PG_PASSWORD`, `PORTAL_PG_DATABASE` and `PORTAL_PG_ALLOW_LOCAL=true` for an isolated localhost test server. Set `ARKS_TEST_PG_CONFIG` to its absolute path and run `npm test`. This test path creates and drops disposable fixture databases; never point it at a production administrator connection. GitHub CI also runs the application tests against an isolated PostgreSQL service.

## Documentation delivery

Professional manuals and rendered diagrams are delivered separately as PDFs, per the owner's instruction. **No PDF files are committed here.** The existing text documents under `public/docs/` remain only as application assets to preserve the current in-app documentation links; they are not the professional documentation handover.

The separate PDF set covers system architecture, authentication, request/data contracts, portal management, automation/assessments, GitHub/deployment, operations/verification and the configuration register. The manuals clearly distinguish implemented features, previous smoke-test evidence and pending Azure/Entra activation.

## Credentials

Use server runtime settings or Azure Key Vault. Never put client secrets, API keys, student exports or tokens into source, issues or Actions logs. `.env.example` lists names only. Several bootstrap/upgrade scripts expect nonsecret local Azure/Google configuration JSON generated in the operator's signed-in Cloud Shell; those actual configuration files are deliberately not included.


## Campus operations release 1.2

Course SOPs, immediate batch assignment for existing students, scoped admin drafts,
direct/bulk material release, source exclusions, automatic daily/weekly/completed-topic
tests, student performance and named Drive submission folders are implemented.
Existing database tables are reused; no schema migration is required.

The web/API workflow does not deploy the separately hosted Python worker. From signed-in
Azure Cloud Shell at the repository root, run:

```bash
git pull --ff-only
python3 azure/upgrade-engine.py
python3 azure/connect-portal-worker.py
python3 azure/operate.py smoke
```

The upgrade pauses the timer. After a successful smoke check, enable the existing
03:00/10:00 IST schedule with `python3 azure/operate.py enable`. Immediate Sync Up
works without the timer once the engine is connected. Enter DeepSeek credentials
only at the hidden prompt. Existing resources are reused; missing nonsecret worker
configuration can be recovered from the known Function App.

Set each batch's Assessment studio automation policy. Map class numbers to exact SOP
topics; do not use incidental tool keywords to infer completion. Automatic publication
can be disabled independently of generation. Scanned images require OCR text or readable
notes; the engine does not watch recordings. Entra group synchronization remains
unimplemented; existing role, enrollment and optional portal-group checks still apply.
Professional PDF operations documentation is delivered separately, outside this repository.
