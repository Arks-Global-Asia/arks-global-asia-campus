import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../server/api.js";
import { database, memoryBucket } from "../scripts/database.mjs";
import { hash } from "../server/common.js";
import { queueJob } from "../server/features.js";
async function fixture() {
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    LOCAL_DEV_OWNER: "true",
    IMPORTER_TOKEN_SHA256: await hash("test-importer"),
  };
  async function call(path, body, role = "admin", cookie) {
    const headers = { "Content-Type": "application/json" };
    if (role === "service") headers["X-Arks-Importer-Token"] = "test-importer";
    else if (role) {
      headers["oai-authenticated-user-id"] = role;
      headers["oai-authenticated-user-email"] = role + "@arks.test";
    }
    if (cookie) headers.cookie = cookie;
    return api(
      new Request("https://campus.test/api/" + path, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
  }
  await call("bootstrap");
  return { env, call };
}
test("admin password login uses private sessions, rejects roles and revokes old sessions", async () => {
  const { env, call } = await fixture();
  assert.equal(
    (
      await call("admin/password", {
        email: "admin@arks.test",
        password: "long-unique-test-password",
        name: "Admin",
      })
    ).status,
    200,
  );
  const r = await call(
    "auth/admin",
    { email: "admin@arks.test", password: "long-unique-test-password" },
    null,
  );
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.match(r.headers.get("set-cookie"), /HttpOnly; Secure/);
  env.AUTH_MODE = "google";
  assert.equal((await call("admin/data", null, null, cookie)).status, 200);
  assert.equal((await call("admin/data", null, "admin")).status, 401);
  assert.equal(
    (
      await call(
        "auth/admin",
        { email: "admin@arks.test", password: "bad" },
        null,
      )
    ).status,
    401,
  );
  await call("auth/logout", {}, null, cookie);
  assert.equal((await call("admin/data", null, null, cookie)).status, 401);
  const row = await env.DB.prepare("SELECT * FROM admin_credentials").first();
  assert.notEqual(row.password_hash, "long-unique-test-password");
});
test("disabled users and revoked batch-group members cannot access campus or resource data", async () => {
  const { call } = await fixture();
  await call("bootstrap", null, "student");
  await call("admin/group", {
    batch_id: "sandbox",
    name: "Batch learners",
    members: "student@arks.test",
    fee: 0,
  });
  await call("admin/batch-config", {
    batch_id: "sandbox",
    require_google_group: true,
  });
  assert.equal(
    (await call("campus?batch=sandbox", null, "student")).status,
    200,
  );
  const f = await (await call("admin/features")).json();
  await call("admin/group", {
    id: f.groups[0].id,
    batch_id: "sandbox",
    name: "Batch learners",
    members: "",
  });
  assert.equal(
    (await call("campus?batch=sandbox", null, "student")).status,
    403,
  );
  assert.equal(
    (await (await call("bootstrap", null, "student")).json()).batches.length,
    0,
  );
  await call("admin/access", { user_id: "student", active: false });
  assert.equal((await call("bootstrap", null, "student")).status, 403);
});
test("class series can be created, cancelled as a series and individually restored", async () => {
  const { env, call } = await fixture();
  let r = await call("admin/sessions", {
    batch_id: "sandbox",
    title: "Class {n}",
    dates: ["2026-12-01T16:00:00Z", "2026-12-02T16:00:00Z"],
    url: "https://meet.google.com/example",
  });
  assert.equal(r.status, 200);
  const c = (
    await env.DB.prepare(
      "SELECT * FROM content WHERE series_id IS NOT NULL",
    ).all()
  ).results;
  assert.equal(c.length, 2);
  await call("admin/sessions", {
    batch_id: "sandbox",
    id: c[0].id,
    series_id: c[0].series_id,
    whole_series: true,
    action: "cancel",
  });
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM content WHERE session_status='cancelled'",
      ).first()
    ).n,
    2,
  );
  await call("admin/sessions", {
    batch_id: "sandbox",
    id: c[0].id,
    action: "restore",
  });
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM content WHERE session_status='cancelled'",
      ).first()
    ).n,
    1,
  );
});
test("AI job leases reject duplicates and invalid answers; generated tests remain batch-scoped drafts", async () => {
  const { env, call } = await fixture();
  const id = await queueJob(env.DB, "generate_test", "sandbox", "generated", {
    count: 2,
    source_ids: ["notes-git"],
    course_id: "devops",
    title: "Approved materials quiz",
    kind: "daily",
    topic_order: 2,
    duration: 20,
  });
  assert.equal((await call("automation/jobs", null, "student")).status, 401);
  const claim = await (
    await call("automation/jobs/claim", { id }, "service")
  ).json();
  assert.ok(claim.lease);
  assert.equal(
    (await call("automation/jobs/claim", { id }, "service")).status,
    409,
  );
  assert.equal(
    (
      await call(
        "automation/jobs/finish",
        { id, lease: "incorrect", result: {} },
        "service",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "automation/jobs/finish",
        { id, lease: claim.lease, result: { questions: [] } },
        "service",
      )
    ).status,
    400,
  );
  const qs = [
    {
      prompt: "Git commits?",
      options: ["Snapshots", "Containers"],
      answer: 0,
      explanation: "Git records snapshots.",
    },
    {
      prompt: "Git branches?",
      options: ["References", "Images"],
      answer: 0,
      explanation: "Branches point to commits.",
    },
  ];
  assert.equal(
    (
      await call(
        "automation/jobs/finish",
        { id, lease: claim.lease, result: { questions: qs } },
        "service",
      )
    ).status,
    200,
  );
  const t = await env.DB.prepare(
    "SELECT * FROM tests WHERE id='generated'",
  ).first();
  assert.equal(t.published, 0);
  assert.equal(t.batch_id, "sandbox");
  assert.equal(t.ai_generated, 1);
});
test("single attempt is idempotent, totals exactly 100, feedback job and branded PDF stay private", async () => {
  const { env, call } = await fixture();
  await env.DB.prepare(
    "UPDATE tests SET ai_generated=1 WHERE id='daily-git'",
  ).run();
  const starts = await Promise.all([
    call("tests/start", { batch_id: "sandbox", test_id: "daily-git" }),
    call("tests/start", { batch_id: "sandbox", test_id: "daily-git" }),
  ]);
  const a = await starts[0].json(),
    b = await starts[1].json();
  assert.equal(a.id, b.id);
  const result = await (
    await call("tests/submit", { attempt_id: a.id, answers: [0, 1, 2] })
  ).json();
  assert.equal(result.score, 100);
  assert.equal(result.total, 100);
  assert.equal(
    (await call("tests/start", { batch_id: "sandbox", test_id: "daily-git" }))
      .status,
    400,
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT count(*) n FROM engine_jobs WHERE kind='evaluate_test'",
      ).first()
    ).n,
    1,
  );
  assert.equal((await call("result-pdf/" + a.id, null, "student")).status, 404);
  const pdf = await call("result-pdf/" + a.id);
  assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
  assert.equal(
    new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 4)),
    "%PDF",
  );
});
test("Google group snapshots are service-only and stale group mappings cannot grant access", async () => {
  const { env, call } = await fixture();
  await env.DB.prepare(
    "INSERT INTO access_groups VALUES ('g','Learners','learners@arks.test','sandbox')",
  ).run();
  assert.equal(
    (
      await call(
        "automation/groups/snapshot",
        {
          id: "g",
          google_group: "other@arks.test",
          members: ["student@arks.test"],
        },
        "service",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "automation/groups/snapshot",
        {
          id: "g",
          google_group: "learners@arks.test",
          members: ["student@arks.test"],
        },
        "service",
      )
    ).status,
    200,
  );
  assert.equal(
    (await env.DB.prepare("SELECT email FROM group_members").first()).email,
    "student@arks.test",
  );
});

test("mixed questions hide rubrics, persist answers and apply bounded partial credit to 100 marks", async () => {
  const { env, call } = await fixture();
  const qs = [
    {
      type: "multi_select",
      prompt: "Choose source control tools",
      options: ["Git", "Mercurial", "Docker"],
      answer: [0, 1],
      marks: 25,
    },
    {
      type: "short_answer",
      prompt: "Explain a safe rollout",
      answer: "Use staged deployment, health checks and rollback.",
      rubric: "Credit health checks and rollback.",
      marks: 50,
    },
    {
      type: "code",
      prompt: "Write a status command",
      answer: "git status",
      rubric: "A valid Git working-tree status command.",
      marks: 25,
    },
  ];
  assert.equal(
    (
      await call("admin/save", {
        entity: "tests",
        values: {
          id: "mixed",
          course_id: "devops",
          title: "Mixed assessment",
          kind: "monthly",
          topic_order: 1,
          duration: 30,
          questions: JSON.stringify(qs),
          published: 1,
        },
      })
    ).status,
    200,
  );
  const a = await (
    await call("tests/start", { batch_id: "sandbox", test_id: "mixed" })
  ).json();
  assert.equal(a.questions[1].answer, undefined);
  assert.equal(a.questions[1].rubric, undefined);
  assert.equal(
    a.questions.reduce((n, q) => n + q.marks, 0),
    100,
  );
  const answers = [[0, 1], "Check health before expanding", "git status"];
  assert.equal(
    (await call("tests/save", { attempt_id: a.id, answers })).status,
    200,
  );
  assert.deepEqual(
    (
      await (
        await call("tests/start", { batch_id: "sandbox", test_id: "mixed" })
      ).json()
    ).answers,
    answers,
  );
  const r = await (
    await call("tests/submit", { attempt_id: a.id, answers })
  ).json();
  assert.equal(r.score, 25);
  assert.equal(r.grading_status, "pending");
  const j = await env.DB.prepare("SELECT id FROM engine_jobs WHERE entity_id=?")
    .bind(a.id)
    .first();
  const claim = await (
    await call("automation/jobs/claim", { id: j.id }, "service")
  ).json();
  const feedback = [
    { marks: 99, feedback: "Both correct." },
    { marks: 25, feedback: "Health checks are correct; add rollback." },
    { marks: 25, feedback: "Correct command." },
  ];
  const summary = {
    strengths: ["Strong grasp of source control and Git status commands"],
    improvements: ["Include automatic rollback triggers in Kubernetes deployments"],
    recommendations: [
      {
        title: "Kubernetes Deployments & Rollbacks",
        category: "official_doc",
        url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/",
        description: "Review rollingUpdate strategy and kubectl rollout undo.",
      },
      {
        title: "Batch Class Notes — Git & Deployment Strategies",
        category: "notes",
        url: "",
        description: "Revisit Topic 1 & Topic 4 class notes and recordings.",
      },
    ],
  };
  assert.equal(
    (
      await call(
        "automation/jobs/finish",
        { id: j.id, lease: claim.lease, result: { feedback, summary } },
        "service",
      )
    ).status,
    200,
  );
  const final = await (await call("results/" + a.id)).json();
  assert.equal(final.score, 75);
  assert.equal(final.grading_status, "complete");
  assert.equal(final.feedback[0].marks, 25);
  assert.deepEqual(final.summary.strengths, summary.strengths);
  assert.deepEqual(final.summary.improvements, summary.improvements);
  assert.equal(final.summary.recommendations.length, 2);
  assert.equal(
    final.summary.recommendations[0].url,
    "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/",
  );
  const pdfRes = await call("result-pdf/" + a.id);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get("Content-Type"), "application/pdf");
  const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
  assert.ok(pdfBytes.byteLength > 1000);
});
test("objective formats validate permutations and normalize fractional weights without leaking keys", async () => {
  const { validQuestion, normalizeQuestions, objectiveCorrect, validAnswer } =
    await import("../shared/assessment.js");
  const questions = [
    {
      type: "fill_blank",
      prompt: "Command?",
      accepted_answers: ["git status"],
    },
    { type: "numeric", prompt: "Count?", answer: "42", tolerance: 0.1 },
    {
      type: "matching",
      prompt: "Match",
      options: ["Git", "Docker"],
      matches: ["Containers", "Versions"],
      answer: [1, 0],
    },
    {
      type: "ordering",
      prompt: "Order",
      options: ["Push", "Add", "Commit"],
      answer: [1, 2, 0],
    },
  ];
  assert.ok(questions.every(validQuestion));
  assert.equal(
    normalizeQuestions(questions).reduce((s, q) => s + q.marks, 0),
    100,
  );
  assert.ok(objectiveCorrect(questions[0], " GIT STATUS "));
  assert.ok(objectiveCorrect(questions[1], "42.05"));
  assert.ok(objectiveCorrect(questions[2], [1, 0]));
  assert.ok(objectiveCorrect(questions[3], [1, 2, 0]));
  assert.equal(validAnswer(questions[2], [1, 1]), false);
});

test("automated 9:00 AM IST daily test (20+ Qs Mon-Sat) and Sunday weekly test (25+ Qs) schedule and skip when no classes taught", async () => {
  const { env, call } = await fixture();

  // 1. When no materials were taught on 2026-11-10 (Tuesday), Wednesday 9:00 AM IST skips daily test
  const skipDaily = await (
    await call(
      "automation/schedule-assessments",
      { reference_date: "2026-11-11T03:30:00Z" },
      "service",
    )
  ).json();
  assert.equal(skipDaily.mode, "daily");
  assert.equal(skipDaily.results[0].status, "skipped");
  assert.equal(skipDaily.results[0].reason, "no_class_materials");

  // 2. Publish class materials for Wednesday night (2026-11-18 IST)
  await env.DB.prepare(
    "UPDATE content SET created='2026-11-18T16:30:00Z' WHERE id IN ('notes-git','slides-git','guide-linux')",
  ).run();

  // 3. Thursday 9:00 AM IST (2026-11-19T03:30:00Z) queues a Daily Assessment with >= 20 questions including 'code'
  const runDaily = await (
    await call(
      "automation/schedule-assessments",
      { reference_date: "2026-11-19T03:30:00Z" },
      "service",
    )
  ).json();
  assert.equal(runDaily.mode, "daily");
  assert.equal(runDaily.results[0].status, "queued");
  assert.ok(runDaily.results[0].count >= 20);
  const dailyJob = await env.DB.prepare("SELECT * FROM engine_jobs WHERE id=?")
    .bind(runDaily.results[0].job_id)
    .first();
  const dailyPayload = JSON.parse(dailyJob.payload);
  assert.ok(dailyPayload.question_types.includes("code"));

  // 4. Sunday 9:00 AM IST never runs a daily test even if mode='daily' is requested on Sunday
  const sundayDailyCheck = await (
    await call(
      "automation/schedule-assessments",
      { reference_date: "2026-11-22T03:30:00Z", mode: "daily" },
      "service",
    )
  ).json();
  assert.equal(sundayDailyCheck.mode, "skipped_sunday_daily");

  // 5. Sunday 9:00 AM IST (2026-11-22T03:30:00Z) queues a Weekly Assessment with >= 25 questions covering Mon-Sat
  const runWeekly = await (
    await call(
      "automation/schedule-assessments",
      { reference_date: "2026-11-22T03:30:00Z" },
      "service",
    )
  ).json();
  assert.equal(runWeekly.mode, "weekly");
  assert.equal(runWeekly.results[0].status, "queued");
  assert.ok(runWeekly.results[0].count >= 25);

  // 6. Sunday 9:00 AM IST on a week where NO classes were taught Monday-Saturday (e.g., 2026-11-08) skips Weekly Assessment
  await env.DB.prepare(
    "UPDATE content SET created='2026-11-18T16:30:00Z'",
  ).run();
  const skipWeekly = await (
    await call(
      "automation/schedule-assessments",
      { reference_date: "2026-11-08T03:30:00Z" },
      "service",
    )
  ).json();
  assert.equal(skipWeekly.mode, "weekly");
  assert.equal(skipWeekly.results[0].status, "skipped");
  assert.equal(skipWeekly.results[0].reason, "no_classes_this_week");

  // 7. When a batch's automation_sources config has auto_daily_test: false, automatic cron skips it
  await call("admin/automation/source", {
    batch_id: "sandbox",
    folder_input: "https://drive.google.com/drive/folders/folder_123456789",
    config: { auto_daily_test: false },
  });
  const disabledAuto = await (
    await call(
      "automation/schedule-assessments",
      { reference_date: "2026-11-20T03:30:00Z" },
      "service",
    )
  ).json();
  assert.equal(disabledAuto.results[0].status, "skipped");
  assert.equal(disabledAuto.results[0].reason, "auto_schedule_disabled");
});
