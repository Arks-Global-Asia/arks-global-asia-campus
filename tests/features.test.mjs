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
  assert.equal(
    (
      await call(
        "automation/jobs/finish",
        { id: j.id, lease: claim.lease, result: { feedback } },
        "service",
      )
    ).status,
    200,
  );
  const final = await (await call("results/" + a.id)).json();
  assert.equal(final.score, 75);
  assert.equal(final.grading_status, "complete");
  assert.equal(final.feedback[0].marks, 25);
  assert.equal((await call("result-pdf/" + a.id)).status, 200);
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

test("an unsupported auth mode cannot fall back to trusted Sites headers", async () => {
  const { env, call } = await fixture();
  env.AUTH_MODE = "entra";
  assert.equal((await call("bootstrap")).status, 503);
  assert.equal((await call("admin/data")).status, 503);
});
