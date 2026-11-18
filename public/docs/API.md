# API reference

All routes are relative to `/api`. All require trusted Sites identity headers. Mutations accept JSON except `/upload`, which accepts multipart form data. Authentication uses the stable Site user ID. Never supply identity headers from application JavaScript.

Errors: `{"error":"human readable message"}`. Typical status codes: 400 invalid data, 401 no identity, 403 insufficient permissions, 404 absent/inaccessible record, 405 unsupported method, 503 missing storage. Responses use `Cache-Control: no-store`.

| Method | Route | Behavior |
|---|---|---|
| GET | `/bootstrap` | User, permitted batches, courses; activate email invitations |
| POST | `/profile` | Update own name, phone, goal and onboarding flag |
| GET | `/campus?batch=<id>` | Authorized batch content, tests, own progress/submissions/queries/results/enrollment/payments |
| POST | `/complete` | `{batch_id,content_id,complete}`; own self-completable resources only |
| POST | `/submissions` | `{batch_id,content_id,body,file_id?}`; submit lab answer |
| POST | `/tickets` | `{batch_id,subject,body}`; create own query |
| POST | `/tests/start` | `{batch_id,test_id}`; resume active or create attempt; public question projection |
| POST | `/tests/submit` | `{attempt_id,answers:[0,1,null]}`; zero-based options; server grading |
| GET | `/results/<attempt>` | Own submitted result, or any result for admin |
| POST | `/upload` | Multipart `file`; max 20 MB; returns `{id,name}` |
| GET | `/files/<id>` | Authorized attachment download |
| GET | `/admin/data` | Admin operational data; max 5,000 rows per table, latest 100 audit events |
| POST | `/admin/save` | `{entity,values}`; courses, batches, invitations, content or tests |
| POST | `/admin/payment` | `{enrollment_id,amount,reference,paid_at}`; minor units, unique reference |
| POST | `/admin/review` | `{id,status,feedback}`; accepted/revision_requested/submitted |
| POST | `/admin/reply` | `{id,reply,status}`; open/resolved |
| POST | `/admin/role` | `{id,role}`; admin/student, immutable owner role |

## Record conventions

IDs are UUIDs except documented seeded records (`devops`, `sandbox`, resource/test seed IDs). Foreign keys are checked. Optional resource `batch_id` is null for all batches in the course. `published` is integer 0/1. Dates/times are ISO 8601; API session times are normalized to UTC. UI fee inputs are multiplied by 100 before sending; API money is always integer minor units.

A question record contains `{prompt, options: string[], answer: number, explanation?: string}`. Start responses omit `answer` and `explanation`. Submission results include explanations. Existing attempts contain their immutable snapshot.

## Authorization rules

- Every admin route checks role server-side.
- Student reads and writes require enrollment in the batch.
- Personal results, payments, queries and submissions are filtered by user ID.
- Student file downloads require ownership or a published resource in an enrolled course/batch. Administrators can download campus files.
- Cross-origin mutation requests with a mismatched Origin are rejected.
- Resource URLs allow HTTPS only; React escapes text. Files are forced to attachment downloads with `nosniff`.
- Fields and entity/table names are allowlisted; SQL values are parameterized.


## Campus upgrade
See [CAMPUS-UPGRADE.md](CAMPUS-UPGRADE.md) for the current authentication, mixed-question assessments, server autosave, Azure engine activation and Google Group setup. See [UPGRADE-ARCHITECTURE.md](UPGRADE-ARCHITECTURE.md) for the integration diagram. These upgrade documents supersede earlier provider-specific setup notes.

### Upgrade endpoints
All `/api/admin/*` routes require an active administrator. All user routes require an authenticated active account. All `/api/automation/*` routes require the importer secret and hosting service access.

| Endpoint | Purpose |
|---|---|
| GET `/api/auth/config` | Authentication readiness only; never returns secrets |
| GET `/api/auth/google/start`, `/callback` | Google authorization-code login with state/nonce/JWT verification |
| POST `/api/auth/admin`, `/logout` | Admin password session / revoke session |
| GET `/api/admin/features` | Group mappings and job metadata |
| POST `/api/admin/password`, `/access`, `/group` | Credentials, account activation, batch groups |
| POST `/api/admin/batch-config`, `/sessions` | Course overview, support, SOP roadmap, submission folder, session series |
| POST `/api/admin/generate-test`, `/extract-sop` | Queue approved-source AI work |
| GET `/api/admin/job-result` | Review completed SOP extraction |
| POST `/api/admin/apply-roadmap`, `/retry-job` | Approve roadmap / retry failed job |
| POST `/api/admin/automation/sync` | Immediate Azure dispatch when configured; otherwise mark scan requested |
| POST `/api/tests/save` | Autosave answers for your unsubmitted attempt before expiry |
| GET `/api/result-pdf/:attemptId` | Private branded PDF for submitted result |
| GET `/api/automation/jobs`, POST `/claim`, `/finish` | Queue discovery and leased job processing (claim/finish under jobs/) |
| GET `/api/automation/job-file` | Read one authorized source file with active job ID and lease |
| GET `/api/automation/groups`, POST `/groups/snapshot` | Remote mapping discovery and verified membership snapshots |

Question types and validators are defined in `shared/assessment.js`. Public questions exclude answer keys and rubrics. Submitted snapshots retain the exact question set, marks and rubric used when the attempt began. Assessment status remains pending until subjective grading succeeds. Autosave cannot modify submitted answers.
