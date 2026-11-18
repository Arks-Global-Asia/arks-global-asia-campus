# Administrator guide

## Prepare your first real batch

1. Open **Admin portal → Courses**. Edit the starter course, use the visual roadmap builder, and set the default fee/currency.
2. Open **Batches → Create batch**. Choose the course, name, dates and IANA timezone (for example `Asia/Kolkata`). Set topics covered to zero until teaching starts.
3. Open **Onboarding → Enroll by email**. Enter the exact email the student uses to sign in, the batch, student role, and their agreed fee. Amounts in forms are full units (₹5,000 is entered as `5000`).
4. Configure Site access to permit the students, then share the campus link through your normal communication channel. This app does not send invitations automatically.
5. At the student’s next authenticated API request, the email enrollment activates. It appears under People and Reports.

A student may have several enrollment records across batches. Use a distinct batch for each cohort. Existing enrollment fees are not changed by editing an invitation. Keep the zero-fee starter batch for internal testing, or archive it.

## Content and live sessions

**Content & sessions → Add resource** supports live session, recording, notes, lab, presentation, resource guide and SOP. Select the course and optionally a single batch. All-course scope shares a resource across future batches.

For live sessions, set a UTC start time and duration. The student display uses the batch timezone. Example: 7:00 PM India time is 13:30 UTC. Add your real Meet/Zoom/Teams HTTPS meeting URL. Students can download an `.ics` calendar event.

For recordings, paste the provider’s HTTPS recording URL. For notes/slides/guides/SOP, write instructions, attach a supported file, or link a Drive resource. The existing Drive materials retain their original access controls.

Use **Draft** to hide a resource. The system retains existing history. Uploads allow PDF, PNG/JPEG/WebP, TXT/Markdown, ZIP, DOCX, PPTX, XLSX and CSV, up to 20 MB. Files are downloaded as attachments.

## Assessments

Create daily, weekly or monthly tests. Set the prerequisite topic number and duration (1–180 minutes). Use the question builder to add prompts, options, the correct option and explanations. Publish the test.

After a class, increase **Batches → Topics covered in class**. Tests at or below that number unlock. Each student gets one attempt per test per batch. Existing attempts retain the original question set even if the test is edited.

Review results under Reports. Instant explanations are intended for learning; do not use the same item bank for high-stakes, proctored examinations.

## Labs

Open **Lab reviews**, choose **Review**, read the student’s answer and download attachments as needed. Add feedback and select Accepted or Revision requested. Accepted work counts toward completion. If acceptance is revoked and no other accepted submission exists for that student/lab/batch, its completion is removed.

## Queries

Open Queries, read a question, enter a reply and choose Open or Resolved. The student sees the reply in their own campus. Current queries are a subject/message plus one editable admin reply, not a multi-message chat system.

## Fees

The agreed fee is captured on enrollment. **Fees → Record payment** records money already received through another system. Choose the enrollment, amount, unique provider/bank reference and date. Duplicate references and overpayments are rejected. No payment gateway is connected; the app does not collect money or issue tax invoices.

The ledger is append-only in the UI. Incorrect entries or fee changes require a reviewed operational correction with an audit record. Do not casually delete financial records.

## Reports and roles

Reports exports CSV with student, email, batch, currency, fee, paid, balance and completion. People permits administrator/student role changes, except the original owner cannot be demoted. Grant admin access only to staff: administrators can see all campus records.

Activity shows the latest 100 administrative mutations. There is no hard-delete UI; archive batches and unpublish content/tests to retain history.


## Campus upgrade
See [CAMPUS-UPGRADE.md](CAMPUS-UPGRADE.md) for the current authentication, mixed-question assessments, server autosave, Azure engine activation and Google Group setup. See [UPGRADE-ARCHITECTURE.md](UPGRADE-ARCHITECTURE.md) for the integration diagram. These upgrade documents supersede earlier provider-specific setup notes.
