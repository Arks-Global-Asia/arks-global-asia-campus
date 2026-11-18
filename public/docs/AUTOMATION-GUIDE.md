# Admin automation guide

Open **Admin portal → Automation**. Generated course materials can now be imported automatically, but remain invisible to students until approved.

## Connect a current or future batch

1. Create the batch under Batches. Enter its Drive folder name or folder link in the new optional field.
2. Alternatively, use Automation → Connect a batch folder and select an existing batch.
3. Prefer a folder link when several folders have the same name. Name lookup requires one exact match; ambiguity becomes a visible error.
4. Keep automatic checking enabled. New batches are discovered from saved mappings on each background run; the recurring job does not need to be recreated.
5. Configure real batch dates and topics covered. These are not inferred from generated files.

**Request scan** queues a source for priority on the next scheduled check; it does not claim to launch an immediate cloud task. **Refresh status** reloads the latest records. A paused source is skipped.

## Review and release

The Content inbox shows imported revisions by batch and status. Open the copied attachment or its Drive source, review it, edit the student title/topic/instructions, and confirm it is safe to share. Then select **Approve & release**. Rejection leaves it hidden.

Approved files are scoped to their batch. A new revision returns to the inbox. The previously approved copied attachment remains visible until the update is approved. Linked Drive resources keep their provider permissions and can change outside the portal; copies are preferred for notes and presentations. Inspect presenter notes too: file names cannot prove that a deck contains no answer keys.

Answer keys, solutions, grading results, response sheets, drafts and unknown materials are restricted and cannot be released via this inbox. Google Form assessments require their published student response URL, never an edit link. An assessment unlocks according to its assigned topic number and the batch’s topics-covered value.

## What is automatic

- Discovering enabled batch mappings at each scheduled scan.
- Exact folder lookup and bounded traversal of learning-material folders.
- Creating pending imports, detecting repeated revisions and retaining run history.
- Copying supported original files up to 20 MB when the Drive connection permits it.

## What still needs an administrator

- Choosing the correct batch/folder mapping and resolving ambiguous folder names.
- Reviewing and releasing each new revision.
- Entering real class coverage, meeting links, batch dates, fees and enrollments.
- Publishing the actual Google Form and supplying its student URL.

Existing Gemini/ChatGPT content-generation schedules are separate and are not resumed or replaced by the importer. Automatic generation, arbitrary-format workbook grading ingestion and per-student external score import are not added by this material importer. Results workbooks remain instructor-only until that separate integration is configured.

## Troubleshooting

Run history shows succeeded, partial or failed scans. A partial scan may have usable drafts but incomplete folder coverage or failed file copies. A missing/ambiguous folder, expired credentials or provider access problem is shown on the source card. Retry after fixing the cause; revision deduplication makes repeated scans safe.

Changing a source folder starts a new import generation. Old approved resources stay published; unpublish them separately if they should no longer be available. Old unreviewed imports cannot be released from the new mapping.

The inbox shows the newest 500 revisions and 100 runs. All older records remain in storage; server-side pagination is a future scale improvement.
