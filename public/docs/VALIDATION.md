# Validation

## Executed checks

- Production React/Vite build and bundled Worker artifact generation succeeded.
- All 17 automated tests passed, including a DOM interaction test (JSDOM, not a real browser).
- Fresh D1-compatible schema application using SQLite with foreign keys enabled.
- Authentication rejection, admin-only operations and cross-student isolation.
- Email-based enrollment, profile updates and resource completion persistence.
- Lab submission, instructor acceptance, completion and query resolution.
- Test answer secrecy before submission, server grading, result ownership, three-attempt limit and idempotent submission.
- Covered-topic gating, active attempt resume and immutable question snapshots.
- Payment role restrictions, unique references and overpayment rejection.
- Unsafe URL and invalid file reference rejection.
- File upload/download and private file access restrictions.
- Cross-origin mutation rejection.
- DOM workflow: owner onboarding, student overview, admin batches/create dialog, student assessment, answer navigation, submission, result display and database score.

## Verification limits

The managed Sites preview/browser tooling is absent in the execution environment. No screenshot-based review, real-browser responsive layout check, accessibility audit, physical Android install, or load test was performed. JSDOM verifies rendering and interaction logic but does not calculate layout or prove visual quality.

Native deployment status is tracked separately during publication. Local tests use a SQLite adapter for D1 and in-memory R2 bytes; production provider provisioning is not proven by those tests alone.

## Manual acceptance checklist for launch

- Open the private deployment as owner and complete profile onboarding.
- Verify desktop and 360/390 px Android layouts; inspect menu, dialog scrolling and keyboard behavior.
- Use a second enrolled student identity; confirm admin screens are inaccessible and data is isolated.
- Create a second batch, add a learner, publish a session and attach a real document.
- Upload a lab, accept it from admin, confirm completion from student.
- Submit tests at different scores; try expiry, reload/resume and a third attempt.
- Record an actual test payment and confirm the student ledger.
- Confirm actual meeting/recording/Drive links and calendar timezone.
- Install the PWA on an Android device and confirm launch and online data refresh.
- Test backup and restore before using the system for irreplaceable records.

## Automation validation

Seven added API tests cover importer authentication, exact folder resolution, scan leases, revision deduplication, approval-only visibility, restricted materials, source changes, revision replacement and external Form link requirements. The DOM test also opens Automation and its batch-folder dialog. The live unattended service path was exercised against the published Site using its scoped import credential, and current Drive materials were staged for admin review. No student releases were performed.
