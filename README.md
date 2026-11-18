# Arks Global Asia Institutes — Campus

DevOps bootcamp portal for desktop web and Android as an installable PWA.

## Implementation status

This source builds the existing React/Vite + Cloudflare Worker application using D1 (SQLite) and R2. The Azure Python worker performs direct Drive scanning and includes an optional AI/job engine. The proposed fully Azure-hosted portal requires API, SQL and object-storage adapters and an Entra callback implementation; those migrations are **not complete** in this repository.

Google OAuth and admin password sessions are implemented. Entra External ID configuration has been selected separately; do not enable public Azure hosting with trusted Sites-header fallback. Local development intentionally injects an owner identity and must remain loopback-only.

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

## Deployment boundaries

- `.openai/hosting.json` retains the existing private Site identity for reproducible source handover. It is not an Azure deployment manifest or a secret.
- `scripts/build.mjs` bundles static client files into a Worker. It does not produce an Azure SQL backend.
- `azure/create-azure-web-host.sh` creates only the proposed frontend hosting resource; it does not migrate or deploy a working Azure portal.
- The existing Drive worker callbacks target the current portal origin. Repoint them only after the replacement importer API and credentials pass a smoke test.
- No credentials, live student records, object-store contents, native Android APK or automated production deployment are included.
- GitHub Actions runs checks only. It does not deploy or need cloud credentials.

## Documentation delivery

Professional manuals and rendered diagrams are delivered separately as PDFs, per the owner's instruction. **No PDF files are committed here.** The existing text documents under `public/docs/` remain only as application assets to preserve the current in-app documentation links; they are not the professional documentation handover.

The separate PDF set covers system architecture, authentication, request/data contracts, portal management, automation/assessments, GitHub/deployment, operations/verification and the configuration register. The manuals clearly distinguish implemented features, previous smoke-test evidence and pending Azure/Entra activation.

## Credentials

Use server runtime settings or Azure Key Vault. Never put client secrets, API keys, student exports or tokens into source, issues or Actions logs. `.env.example` lists names only. Several bootstrap/upgrade scripts expect nonsecret local Azure/Google configuration JSON generated in the operator's signed-in Cloud Shell; those actual configuration files are deliberately not included.
