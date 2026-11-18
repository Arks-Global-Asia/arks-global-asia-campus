# Architecture

## System context

```mermaid
flowchart TD
    Student[Student: desktop / Android PWA] --> Access[Sites access policy and ChatGPT sign-in]
    Admin[Administrator: desktop / Android PWA] --> Access
    Access -->|trusted identity headers| Worker[Cloudflare Worker]
    Worker --> UI[React application assets]
    Worker --> API[Validated API / role and enrollment checks]
    API --> DB[(D1 relational database)]
    API --> Files[(R2 private file bucket)]
    UI -->|user opens approved HTTPS links| External[Meeting / recording provider / Google Drive]
```

## Data relationships

```mermaid
erDiagram
    USERS ||--o{ ENROLLMENTS : has
    COURSES ||--o{ BATCHES : reused_by
    BATCHES ||--o{ ENROLLMENTS : admits
    BATCHES ||--o{ INVITATIONS : matches_email
    COURSES ||--o{ CONTENT : contains
    BATCHES o|--o{ CONTENT : optionally_scopes
    ENROLLMENTS ||--o{ PAYMENTS : records
    USERS ||--o{ COMPLETIONS : earns
    CONTENT ||--o{ COMPLETIONS : tracked_by
    USERS ||--o{ SUBMISSIONS : submits
    CONTENT ||--o{ SUBMISSIONS : receives
    COURSES ||--o{ TESTS : defines
    TESTS ||--o{ ATTEMPTS : has
    USERS ||--o{ ATTEMPTS : takes
    USERS ||--o{ TICKETS : opens
    FILES o|--o{ CONTENT : attaches
    FILES o|--o{ SUBMISSIONS : attaches
```

Each progress, attempt, submission and query carries a batch ID. A student can join another batch without overwriting the original batch’s learning history. Content is shared at course level unless assigned to a particular batch. A batch’s course is immutable after creation to preserve historical enrollment relationships.

Money is stored in integer minor currency units. The initial UI assumes two decimal minor units (INR/USD/EUR); use two-decimal currencies. An enrollment snapshots its agreed fee when activated. Editing an invitation later does not rewrite an existing enrollment’s fee.

## Enrollment flow

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as Worker API
    participant D as D1
    participant S as Student
    A->>API: Save email + batch + agreed fee
    API->>D: Insert invitation
    S->>API: Sign in and request bootstrap
    API->>D: Resolve stable user ID and matching email invitations
    API->>D: Insert enrollment if absent
    API-->>S: Authorized batches and profile
```

The first authenticated request claims the singleton owner record atomically. This requires initializing the app while its Sites audience remains owner-only. All subsequent identities default to student unless an administrator assigns a role. The host must overwrite/validate identity headers. Never deploy this Worker behind an untrusted proxy that passes client-supplied identity headers.

## Assessment lifecycle

```mermaid
stateDiagram-v2
    [*] --> Locked
    Locked --> Available: required topic covered
    Available --> InProgress: start (one attempt)
    InProgress --> InProgress: close / resume same attempt
    InProgress --> Submitted: submit answers
    InProgress --> Submitted: expired attempt scored zero
    Submitted --> Reviewed: score and explanations displayed
    Reviewed --> Completed: final result
```

Questions and duration are snapshotted when the attempt starts. Client responses contain prompts and options, never answer keys. The server owns the expiry and grading. Late requests beyond a ten-second delivery allowance score zero. Submissions are idempotent; results remain available. This is a learning assessment system, not a proctored certification platform.

## Completion definition

Denominator: currently published notes, slides, guides, recordings and labs visible in the selected course/batch. Notes/slides/guides/recordings are self-reported. Labs are completed by admin acceptance. Live attendance, tests and SOP are excluded from that percentage. Tests are reported separately. Changing the published resource set changes the current percentage; completed records remain stored. This is not an immutable accreditation transcript.

## Growth strategy

1. Add batches by data entry, reusing courses. No code changes are necessary.
2. Use the existing relational keys and course/attempt indexes to keep queries scoped.
3. Add database-side pagination before administrator datasets reach 5,000 rows (the current read cap is explicit).
4. Separate course versions before changing curricula that require historical completion guarantees.
5. For many simultaneous tests, benchmark Worker/D1 capacity, add request throttling and monitoring, and shard by institution if necessary.
6. Large video should stay with a streaming provider. R2 is for small learning files and submissions.
7. Add an asynchronous queue for notifications, malware scanning and large exports when those integrations are enabled.

The model supports growing batches; no large-scale capacity benchmark has been performed. This application currently serves one institution, not independent multi-tenant institutions.
