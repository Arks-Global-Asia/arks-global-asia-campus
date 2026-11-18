# Background material importer — operating instructions

This is the deployed application’s unattended importer contract. Read this document at the beginning of every run. The importer can create drafts and attach files; it cannot publish content or change student records. Administrative approval is mandatory.

## Obtain access on every run

Use the Sites native `get_site` for project `appgprj_6af9a65417448191b28a9cfbfc0f0da6`. Retain `siwc_bypass_bearer_token` only in memory. Send it only to the returned campus origin, currently `https://arks-global-asia-institutes.majesticanchovy2.chatgpt.site`, in BOTH headers:

- `OAI-Sites-Authorization: Bearer <token>` for hosting access.
- `X-Arks-Importer-Token: <token>` for the application’s scoped importer authentication.

The application compares SHA-256 of the second header to a configured server-side fingerprint. Never print, store, place in a shell command/URL, or include this token in prompts. Use an HTTPS client through structured stdin or the tracked `scripts/automation-client.mjs` helper. On this managed environment run it with `node --use-env-proxy scripts/automation-client.mjs` (Node 24+) to honor the inherited network proxy and CA configuration. Pass large non-secret payloads using `body_file` to avoid terminal line-length limits. That helper reads one hidden JSON object from stdin and accepts `token`, `path`, optional `body`, `body_file`, or upload `file_path`, `item_id`, `run_id`, `file_name`, `mime`. It pins the Site origin and refuses redirects. Access to source can be obtained using Sites repository credentials; keep those in memory too. Never deploy or edit the application as part of routine scans.

If authentication fails, report it as a blocker. Do not change site audience, rotate credentials, configure a new fingerprint or bypass authorization during a scheduled run. The owner can update the fingerprint after intentional service-token rotation.

## Run sequence

1. GET `/api/automation/sources`. Process enabled sources only. Prioritize `sync_requested=1`, then oldest `last_sync`. Discover sources fresh on each run so future batches need no schedule changes. Do not create new batch/source mappings during a scheduled run.
2. For each source, POST `/api/automation/claim` with `{source_id}`. A 409 means another scan is active; skip that source. The returned `run_id` is a 50-minute lease. Renew by finishing and claiming another run, not by overlapping work.
3. Resolve the configured folder using native Google Drive tools. A link supplies an exact folder ID, which must be verified as a folder. A name must match exactly ONE accessible folder; multiple or absent matches are a failed scan, not permission to guess. Follow provider pagination. POST `/api/automation/resolve` with `{run_id,folder_id,folder_name}` using observed provider metadata.
4. List direct children and relevant subfolders with paginated native Google Drive search/list tools. Existing batch taxonomy: ppt, notes/pdf, notes/docx, labs/lab_questions, labs/lab_answers, resource_creation_guide, recordings, SOP and knowledge_tests/results. Skip Images, branding/reference_documents, individual student submission subfolders under lab_answers, and unrelated folders. This importer indexes learning materials; it does not import or evaluate students’ private lab submissions. Keep each item’s actual parent ancestry. Folder fetch is capped at 100 children; never treat a capped listing as complete. Follow search pagination instead. Bound a run to 500 files or 40 minutes and report partial coverage accurately. Prioritize recently modified files on subsequent partial scans, while preserving source IDs and revision deduplication.
5. POST `/api/automation/ingest` in chunks of at most 50 items. Each item contains:

```json
{
  "drive_file_id": "<observed Drive ID>",
  "revision": "<observed version or modified timestamp>",
  "name": "<filename>",
  "source_path": "notes/pdf",
  "mime": "application/pdf",
  "size": 12345,
  "url": "<observed canonical Drive URL>",
  "ancestor_ids": ["<actual parent>", "<configured root>"]
}
```

Do not invent revisions, parent IDs, files, upload results or content. The request body is `{run_id,items:[...]}`. The response gives each import ID, status and optional existing file ID. Server classification places recognized learning materials in the approval inbox. Answer keys, solutions, response sheets, results, drafts and unrecognized items are restricted. Names are heuristics, so every release still requires a human to inspect the file.
6. For pending student material without an attachment, copy the original stored file when it is a supported format and at most 20 MB. Use the connected Drive tool’s authenticated raw-file download, materialize its returned file reference, then POST multipart `/api/automation/upload` with `run_id`, `item_id` and `file`. Use the exact returned file, do not regenerate it. Supported: PDF/PPTX/DOCX/TXT/MD/PNG/JPG/JPEG/WebP/ZIP/XLSX/CSV. Native Google documents may remain linked; do not silently export or claim a copy. Recordings remain links; no video transcoding or large video copying is performed. Do not copy restricted answer keys or results into student attachments. If a file changes during download, use refreshed metadata and re-ingest the new revision before uploading, or leave it pending and report the issue.
7. POST `/api/automation/finish` with `{run_id,status,discovered,message}`. Status is `succeeded`, `partial` or `failed`. Include bounded, factual coverage and any attachment failures; no secrets. Only report succeeded after full relevant folder enumeration and all intended supported copies have succeeded. Link-only native files/recordings are expected and should be disclosed in the message. A copied file is an immutable review snapshot; source links retain Drive permissions and may change at the provider.
8. GET `/api/automation/state` to verify the run and imported records persisted. Do not call admin review endpoints. Do not publish or reject files automatically, modify Drive sharing, send messages to students, resume generation tasks, or change grades.

## Existing assessment workflow

Google Forms can be imported for review, but an administrator must supply the published `/viewform` student URL before release. Do not use the Form edit URL. Prompts and answer keys stay instructor-only. Portal-native tests are separate.

Results workbooks remain restricted. This importer does not parse and distribute individual grades. Connecting the external grading workbook requires an explicit per-student result contract and a separate privacy-preserving result importer. Never expose a workbook containing multiple students’ answers through the student library.

## Readiness and changes

A successful deployment is not proof a scheduled run executed. Record actual scans in Run history. The scheduled task must have Google Drive access and a computer capable of making authenticated HTTPS requests. Report connection limitations without fabricating success.
