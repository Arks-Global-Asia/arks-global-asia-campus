> Azure release 1.1: Entra code flow and the PostgreSQL/Blob managed API are now implemented. For the current activation steps, use the repository's `azure/PORTAL-SETUP.md`. The application uses `arks_global_institutes` on the existing Azure PostgreSQL server. Earlier statements below about Entra implementation being pending describe the previous release. Cloud secrets, existing data transfer and live account validation remain operational steps.

# Arks Global Asia Institutes — campus upgrade

## What is implemented
- Responsive branded student/admin portals, full wordmark, clickable navigation, subtle motion with reduced-motion support, per-role welcome tour with Skip / Don't show again.
- Google OAuth login with verified email, secure server sessions, admin password login, role routing, disabled-account checks, local batch access groups and Workspace group synchronization adapter.
- Batch-specific course overview, email/WhatsApp support links, fees paid/total (no student payment ledger), SOP roadmap extraction/review and task progress.
- Session series for 1–180 calendar days with weekdays/exclusions, individual edits, series cancellation and individual restoration.
- Recording cards open Drive; files can be opened/downloaded. PDFs open in the browser; PPTX/DOCX download to a compatible reader. Drive-linked native files open in Drive. Private files are never sent to public document viewers.
- PDF/DOCX lab uploads, private portal storage, queued transfer to the configured Shared Drive folder, transfer status and instructor feedback.
- Daily/weekly/monthly assessments with 11 question types: multiple choice, multiple select, true/false, fill blank, numerical, short answer, essay, scenario/troubleshooting, code/commands, matching and ordering. Admins choose the type mix and question count, review the answer key/rubric, then publish.
- Weights normalized to exactly 100 marks; one resumable attempt; server autosave plus device backup. Objective answers are scored against the approved key; DeepSeek awards bounded partial credit to written responses. Written scores remain provisional until grading completes. Code answers are reviewed as text, not executed in a sandbox.
- New/In progress/Attempted/Passed/Failed filters, branded result PDFs containing each question, student answer, model answer, marks, feedback and revision notes.
- Sync Up dispatches the Azure engine immediately once connected. If not connected, the request remains queued for the scheduled scan. Every imported material and generated assessment needs admin release.

## Activation status
The portal code is deployable now. Live Google OAuth, remote Google Group changes, AI jobs, immediate Sync Up and Drive submission transfers require cloud configuration below. These integrations are not claimed as live until tested with your accounts. Existing Drive scanning remains independent.

The current Sites address is owner-private and has its own platform sign-in gate. Google login inside the app cannot bypass that gate. For student rollout, use a deployment/audience that permits reaching the application login, with `AUTH_MODE=google` set first, or deploy the portal on your production host. Keep the current private audience during setup. This package does not move the portal's D1/R2 data to Azure; only the automation worker runs there.

## Google login (free sign-in option)
1. Open Google Cloud Console, project `gen-lang-client-0246520454` → Google Auth Platform.
2. Configure Branding with institute name, support email and authorized production domain. Choose External for personal Gmail students; Internal permits only your organization's accounts.
3. In Clients create an OAuth **Web application**. Add the exact redirect URI `https://YOUR-PORTAL-ORIGIN/api/auth/google/callback`. For the current private preview it is `https://arks-global-asia-institutes.majesticanchovy2.chatgpt.site/api/auth/google/callback`.
4. Request only `openid email profile`. Add test users while the OAuth app is in Testing. Complete Google's publication/verification requirements for your chosen domain and audience.
5. Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the **portal server environment**, never source code or browser settings. Create an admin password in Access & admins before switching authentication.
6. Set `AUTH_MODE=google` on the production deployment. Confirm an enrolled Google account enters the student portal, an unauthorized account is refused, and admin credentials open administration. The platform hosting gate must also allow that visitor.
7. In admin Batch experience enable **Require access-group membership** if group membership is the access authority. Without that setting, explicit invitations/enrollments remain valid.

Google Cloud IAM is for cloud-resource permissions, not student accounts. Google Groups/Cloud Identity plus the portal's membership checks control campus access. Never grant students Google Cloud project IAM roles just to use this portal.

Google Identity sign-in can be implemented without purchasing Identity Platform; this application uses Google's OpenID Connect flow directly. Cloud Identity Free provides core identity management and initially 50 additional managed-user licenses; user-cap increases may be requested. External Gmail group members are not newly created managed users. Domain registration, Workspace Shared Drive storage, Azure, hosting and DeepSeek are separate costs. Check current terms:
- https://developers.google.com/identity/openid-connect/openid-connect
- https://cloud.google.com/identity/pricing
- https://docs.cloud.google.com/identity/docs/how-to/how-licensing-works-for-cloud-identity
- https://cloud.google.com/identity-platform/pricing (alternative, not used by this implementation)

## Google Group synchronization
Use a verified Workspace/Cloud Identity domain and an administrator authorized to manage group memberships. Consumer Gmail alone cannot enable domain-wide delegation.
1. In Google Cloud Shell run `bash setup-google-groups.sh` from this package's azure directory. It creates a separate `arks-directory` service account and permits the existing Drive reader to sign delegated JWTs for it; no downloadable key is created.
2. In Google Admin Console → Security → Access and data control → API controls → Manage domain-wide delegation, add the printed numeric OAuth client ID with these scopes:
   - `https://www.googleapis.com/auth/admin.directory.group.member.readonly`
   - `https://www.googleapis.com/auth/admin.directory.group.member`
3. Use a dedicated delegated administrator with group membership management privileges, rather than a super-admin account where possible.
4. In Azure Function App environment settings add `GOOGLE_WORKSPACE_ADMIN` (that delegated admin email) and `GOOGLE_DIRECTORY_SERVICE_ACCOUNT=arks-directory@gen-lang-client-0246520454.iam.gserviceaccount.com`.
5. Create the Google Group in Google Admin Console. In portal Access & admins create a batch group with the **exact group email**. The group must already exist. Direct active user members are supported; nested groups are not expanded.
6. Save member changes in the portal. Additions/removals queue an authenticated Azure Directory API job. The portal grants access only after fetching the confirmed remote membership snapshot. Saving a remote group automatically enables membership enforcement for its batch.
7. Membership sync runs with the scheduled dispatch and immediate engine dispatch. With only the 03:00/10:00 IST schedule, external group changes take effect at the next scan; disable an account in the portal for immediate revocation. Existing session requests recheck enforced batch membership. Direct Drive permissions remain a separate Google access control.

Without a managed domain, use Google sign-in plus local portal access groups as the free, simpler option. Leave Google Group email blank and manage enrolled emails in the portal.

## Azure engine upgrade
1. Download the upgrade ZIP, upload it to **Azure Cloud Shell Bash** with the toolbar's Upload/Download files button → Upload.
2. Run `mkdir -p ~/arks-drive-setup`, then `unzip -o ~/Arks-Campus-Upgrade.zip -d ~/arks-drive-setup`.
3. Restore your existing `azure-config.json` beside `~/arks-drive-setup/azure/upgrade-engine.py`. Cloud Shell's ephemeral sessions lose files; keep your nonsecret config backup.
4. Run `cd ~/arks-drive-setup/azure` then `python3 upgrade-engine.py`.
5. Enter the DeepSeek key only at the hidden prompt. It is saved in Key Vault `arks-deepseek-key`; the Function App uses a Key Vault reference. Press Enter to preserve an already configured key. The upgrade preserves the current timer schedule.
6. Confirm four functions index: `dispatch_batches`, `scan_batch`, `engine_dispatch`, `process_engine_job`.
7. Set portal server secrets `AZURE_ENGINE_URL=https://arks-drive-d649a759ed.azurewebsites.net/api/engine/dispatch` and `AZURE_ENGINE_KEY` (a function-specific key for engine_dispatch). Obtain the key securely from Azure's function key interface. Do not paste it into chat, terminal commands, source, URLs or screenshots.
8. Keep the existing `ARKS_HOST_TOKEN`, `ARKS_IMPORTER_TOKEN`, `IMPORTER_TOKEN_SHA256`, WIF and storage settings. Do not rotate them merely for the upgrade.
9. Run `python3 operate.py smoke`; this intentionally leaves the timer disabled. After it passes, run `python3 operate.py enable` to activate the existing schedule. Desired cron: `0 30 4,21 * * *` UTC = 10:00 and 03:00 IST daily.
10. Test Sync Up, approve a source, generate a mixed assessment, review/publish it, submit once, confirm final feedback/PDF, and check Run history. Pause the earlier ChatGPT scheduled importer only after an Azure scheduled scan succeeds.

DeepSeek model defaults to `deepseek-chat`; override `DEEPSEEK_MODEL` in Azure if your account requires another supported model. API usage is billed separately. Small chunks support up to 100 questions, with a separate evaluation call per six answers. Failed jobs are visible and retryable; there is no fake AI fallback.

## Lab destination and readable source files
Add the existing Drive service account as a contributor to a dedicated **Shared Drive** submission destination and put that folder ID in Batch experience. The engine obtains Drive write scope only for submission transfer. Students do not need direct access to the entire submissions folder. Their own portal copy remains downloadable. A Drive link can still require explicit Google sharing; portal login alone does not grant Drive permissions.

Service accounts cannot own files in personal My Drive. A normal shared My Drive folder is therefore insufficient for this upload path. Shared Drives require a supported Workspace edition. This version implements Shared Drive uploads; human OAuth uploads to My Drive would need a separate connector.

PDF text, DOCX, PPTX, TXT/Markdown are extracted for AI. Image-only/scanned notes need OCR; recordings need a transcript or substantive approved class notes. Generation fails visibly when readable material is missing rather than inventing lesson content. The worker never downloads/decodes video for AI.

## Privacy and operations
- Google credentials and DeepSeek keys remain server-side; password hashes are salted PBKDF2, sessions use hashed random tokens and Secure/HttpOnly cookies, login attempts are throttled, and cross-origin mutations are rejected.
- Source approval, role/batch checks, active account checks, engine leases, file scope checks and maximum upload sizes are enforced server-side.
- DeepSeek receives approved lesson text or assessment answers/rubrics for the requested AI jobs. Inform students of this processing in your institute's privacy notice. Student code is never executed.
- DeepSeek grading is automated and can be imperfect. Admins should review generated answer keys and rubrics before release; review job failures and student concerns.
- Inspect job status in Assessment studio; retries reuse the attempt and do not grant extra attempts. Drive submissions use a stable submission property to deduplicate retries.
- The engine uses the same Flex Consumption app, storage queues, Key Vault and managed identity. Additional AI calls, execution time, storage and telemetry can increase the former scan-only monthly estimate. No fixed bill is promised.
- If migrating hosting, retain database IDs, import deduplication state and object IDs; update scanner `ORIGIN`, OAuth redirect URI, service credentials and hosting authorization accordingly.
