# Arks Global Asia Institutes

A responsive DevOps learning campus for the web and Android (installable PWA). The logo comes from the supplied `arks_global_asia.png` in Google Drive. The visual system uses its navy blue, light glass surfaces, restrained icons, and soft green progress accents.

## Automation update

Admin portal → Automation provides per-batch Drive mappings, a draft approval inbox, revision tracking, private instructor-material handling and run history. Batch setup accepts a folder name or link. See `AUTOMATION-GUIDE.md` for controls and `AUTOMATION-RUNBOOK.md` for the background importer. Generation schedules and individual external grade ingestion are separate.

## What is implemented

- ChatGPT/Sites sign-in; server-enforced administrator and student roles.
- Profile onboarding; email-matched enrollment into multiple batches.
- Shared courses and curricula, independent batch dates, timezone, covered topics and status.
- Personalized dashboard, searchable resources, live-session links and calendar downloads.
- Recordings, notes, slide decks, resource guides, SOP and lab instructions.
- Private R2 uploads, lab answers, instructor feedback, and acceptance-driven lab completion.
- Daily, weekly and monthly assessments; prerequisite topic gating; timed attempts; server-side scoring; one attempt; saved results and explanations.
- Completion reports and administrator enrollment CSV export.
- Queries and concerns with administrator replies and resolution.
- Agreed enrollment fees, payment ledger, outstanding balance and downloadable payment records.
- Administrator management screens, visual syllabus and question builders, draft/published content, and audit history.
- Android web-app manifest, install icons and service worker with a reconnect message. Online access is required for campus data.

## Delivery shape

This is a React 19/Vite client and a Cloudflare Worker API using D1 (SQLite) and R2. The Worker bundles the client assets so the deployment contains a single portable server entrypoint. Generated SQL migrations are included in `drizzle/`.

The environment did not contain the Sites starter/helper scripts or the managed browser preview tools. A compatible Worker build and source packaging workflow are included instead. Browser visual QA and physical Android installation were not performed in this environment. See `VALIDATION.md` for actual checks.

## First launch

1. Open the private Site using its owner account. The first authenticated visitor initializes the owner role; do this while the Site is owner-private.
2. Complete the profile or close the profile dialog to explore.
3. Select **Admin portal** at the bottom of the navigation.
4. Review the starter course and batch. The owner has a zero-fee starter enrollment to exercise the student workflow. No fictional student payments or progress are inserted.
5. Create your actual batch and enrollment records. Publish the schedule and class resources.
6. Before inviting real students, configure the Site audience to allow them. In-app enrollment and Site access are separate controls. This initial delivery remains owner-private.

## Local setup

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run build
npm run dev
```

Standalone local mode listens only on `127.0.0.1:4173`, uses `.local/campus.sqlite` and `.local/files/`, and injects an explicit development owner identity. Never expose that local server to a network. The development identity adapter is not bundled into production.

For a schema change, update `db/schema.js`, then run `npm run db:generate`, inspect the migration, run tests, and build. Do not alter already-applied migrations.

## Available documents

- `ARCHITECTURE.md`: component and entity diagrams, data model and growth plan.
- `ADMIN-GUIDE.md`: day-to-day operations and onboarding.
- `STUDENT-GUIDE.md`: learner workflows and Android installation.
- `API.md`: API routes, validation and authorization.
- `OPERATIONS.md`: release, storage, backup and security operations.
- `VALIDATION.md`: checks performed, limitations and manual acceptance checklist.
- `ROADMAP.md`: future integrations and capacity work.

## Boundaries

Live classes and recordings use administrator-provided HTTPS links; the app is not a video conferencing or video transcoding service. Files support PDF, images, text, ZIP and Office documents up to 20 MB. Payment collection is not integrated: the ledger records payments already received. Enrollment creation does not send email. Google Drive links retain their existing sharing restrictions. Sample syllabus and assessments need instructor review before a real batch starts.

Android delivery is a PWA, not a signed APK/AAB or Play Store listing. Native packaging can use a trusted web activity later, after choosing a public/custom domain and completing Android signing and store requirements.


## Campus upgrade
See [CAMPUS-UPGRADE.md](CAMPUS-UPGRADE.md) for the current authentication, mixed-question assessments, server autosave, Azure engine activation and Google Group setup. See [UPGRADE-ARCHITECTURE.md](UPGRADE-ARCHITECTURE.md) for the integration diagram. These upgrade documents supersede earlier provider-specific setup notes.
