import test from "node:test";
import assert from "node:assert/strict";
import { database, memoryBucket } from "../scripts/database.mjs";
import { api } from "../server/api.js";
import {
  assessmentScopes,
  planAssessments,
  excludedPath,
  officialLinks,
} from "../server/learning.js";
import { hash } from "../server/common.js";
async function fixture() {
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    IMPORTER_TOKEN_SHA256: await hash("worker-test"),
  };
  async function call(path, body, who = "owner") {
    const headers = { "Content-Type": "application/json" };
    if (who === "service") headers["X-Arks-Importer-Token"] = "worker-test";
    else {
      headers["oai-authenticated-user-id"] = who;
      headers["oai-authenticated-user-email"] = who + "@arks.test";
    }
    const r = await api(
      new Request("https://campus.test/api/" + path, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return { status: r.status, data: await r.json() };
  }
  await call("bootstrap");
  return { env, call };
}
test("existing students get immediate dedicated batch enrollment; students cannot assign themselves", async () => {
  const { call, env } = await fixture();
  await call("bootstrap", undefined, "student");
  assert.equal(
    (
      await call(
        "admin/enroll-student",
        { user_id: "student", batch_id: "sandbox", fee: 12000 },
        "student",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("admin/enroll-student", {
        user_id: "student",
        batch_id: "sandbox",
        fee: 12000,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("admin/enroll-student", {
        user_id: "student",
        batch_id: "sandbox",
        fee: 12000,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM enrollments WHERE user_id='student' AND batch_id='sandbox'",
      ).first()
    ).n,
    1,
  );
  assert.equal(
    (await call("campus?batch=sandbox", undefined, "student")).status,
    200,
  );
});
const course = {
  syllabus: JSON.stringify([
    { title: "Git", detail: "Version control" },
    { title: "Jenkins", detail: "Build automation" },
  ]),
};
const pack = (day, topic) =>
  ["recording", "notes", "slides", "lab"].map((kind, i) => ({
    id: day + "-" + i,
    kind,
    published: 1,
    topic,
    topic_order: day,
  }));
test("auto tests wait for full approvals; topic closure uses SOP identity, not incidental tool keywords", () => {
  const batch = {
    config: JSON.stringify({
      assessment_automation: {
        week_size: 2,
        lesson_topics: { 1: "Git", 2: "Git", 3: "Jenkins" },
      },
    }),
  };
  let data = [
    ...pack(1, "Git"),
    ...pack(2, "Git"),
    ...pack(3, "Jenkins integrating Git"),
  ];
  let scopes = assessmentScopes(batch, course, data);
  assert.ok(scopes.some((s) => s.key === "weekly:2"));
  assert.ok(scopes.some((s) => s.kind === "topic" && s.topic === "Git"));
  assert.ok(!scopes.some((s) => s.kind === "topic" && s.topic === "Jenkins"));
  assert.ok(
    !assessmentScopes(batch, course, data, [
      { topic_order: 2, status: "pending", kind: "notes" },
    ]).some((s) => s.kind === "topic"),
  );
  const unmapped = { config: "{}" };
  assert.ok(
    !assessmentScopes(
      unmapped,
      course,
      data.map((c) => ({ ...c, topic: "Git in Jenkins file names" })),
    ).some((s) => s.kind === "topic"),
  );
  data = data.filter((c) => c.id !== "2-3");
  assert.ok(
    !assessmentScopes(batch, course, data).some((s) => s.kind === "topic"),
  );
});
test("automatic generation is durable and idempotent, publishes valid 100-mark tests without manual drafts", async () => {
  const { env, call } = await fixture();
  await env.DB.prepare("UPDATE batches SET config=? WHERE id='sandbox'")
    .bind(
      JSON.stringify({ assessment_automation: { required_kinds: ["notes"] } }),
    )
    .run();
  const a = await planAssessments(env, "sandbox");
  assert.ok(a.queued > 0);
  assert.equal((await planAssessments(env, "sandbox")).queued, 0);
  const job = await env.DB.prepare(
    "SELECT * FROM engine_jobs WHERE kind='generate_test' ORDER BY created LIMIT 1",
  ).first();
  const payload = JSON.parse(job.payload);
  assert.equal(payload.question_types.length, 11);
  const claimed = await call(
    "automation/jobs/claim",
    { id: job.id },
    "service",
  );
  assert.equal(claimed.status, 200);
  const { lease } = claimed.data;
  // Payload type coverage remains enforced, and a missing type cannot publish.
  assert.equal(
    (
      await call(
        "automation/jobs/finish",
        { id: job.id, lease, result: { questions: [] } },
        "service",
      )
    ).status,
    400,
  );
  const qs = Array.from({ length: payload.count }, (_, i) => {
    const type = payload.question_types[i % payload.question_types.length],
      q = {
        type,
        prompt: "Question " + i,
        marks: 1,
        explanation: "Why",
        topic: "Git",
        subtopic: "Commits",
      };
    if (["short_answer", "essay", "scenario", "code"].includes(type))
      return { ...q, answer: "Expected", rubric: "Correct explanation" };
    if (type === "fill_blank") return { ...q, accepted_answers: ["git"] };
    if (type === "numeric") return { ...q, answer: "2" };
    const v = { ...q, options: ["a", "b"], answer: 0 };
    if (["multi_select", "ordering", "matching"].includes(type))
      v.answer = [0, 1];
    if (type === "matching") v.matches = ["A", "B"];
    return v;
  });
  const finished = await call(
    "automation/jobs/finish",
    { id: job.id, lease, result: { questions: qs } },
    "service",
  );
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  const saved = await env.DB.prepare("SELECT * FROM tests WHERE id=?")
    .bind(job.entity_id)
    .first();
  assert.equal(saved.published, 1);
  assert.equal(saved.batch_id, "sandbox");
  assert.equal(
    JSON.parse(saved.questions).reduce(
      (s, q) => s + Math.round(q.marks * 100),
      0,
    ),
    10000,
  );
});
test("folder policies protect excluded paths and restart active leases safely", async () => {
  const { call } = await fixture();
  const folder = "root_folder_123456";
  const source = await call("admin/automation/source", {
    batch_id: "sandbox",
    folder_input: "https://drive.google.com/drive/folders/" + folder,
  });
  let claimed = await call(
    "automation/claim",
    { source_id: source.data.id },
    "service",
  );
  assert.equal(claimed.status, 200);
  const policy = await call("admin/automation/source", {
    batch_id: "sandbox",
    folder_input: "https://drive.google.com/drive/folders/" + folder,
    exclusions: ["audio", "notes/private"],
  });
  assert.equal(policy.status, 200);
  assert.equal(
    (
      await call(
        "automation/resolve",
        {
          run_id: claimed.data.run_id,
          folder_id: folder,
          folder_name: "Batch",
        },
        "service",
      )
    ).status,
    409,
  );
  claimed = await call(
    "automation/claim",
    { source_id: source.data.id },
    "service",
  );
  assert.equal(claimed.status, 200);
  assert.deepEqual(claimed.data.source.exclusions, ["audio", "notes/private"]);
  assert.equal(
    excludedPath("batch/notes/private/key.pdf", null, {
      exclusions: ["notes/private"],
    }),
    true,
  );
  assert.equal(
    excludedPath("batch/notes/private-copy", null, {
      exclusions: ["notes/private"],
    }),
    false,
  );
  const item = {
    drive_file_id: "file_123456789",
    ancestor_ids: [folder],
    source_path: "batch/audio",
    name: "Day1.mp4",
    mime: "video/mp4",
    revision: "1",
    size: 0,
    url: "https://drive.google.com/file/d/file_123456789/view",
  };
  const imported = await call(
    "automation/ingest",
    { run_id: claimed.data.run_id, items: [item] },
    "service",
  );
  assert.equal(imported.data.items[0].excluded, true);
});
test("drafts are isolated per admin and student performance cannot expose another student results", async () => {
  const { call } = await fixture();
  assert.equal(
    (
      await call("admin/draft", {
        key: "course",
        value: { title: "Unsaved course" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("admin/draft?key=course")).data.draft.title,
    "Unsaved course",
  );
  assert.equal(
    (await call("admin/draft", { key: "course", value: {} }, "student")).status,
    403,
  );
  assert.equal(
    (
      await call("admin/draft", {
        key: "course",
        value: { password: "never-save" },
      })
    ).status,
    400,
  );
  await call("admin/save", {
    entity: "invitations",
    values: { email: "student@arks.test", batch_id: "sandbox", fee: 0 },
  });
  const result = await call("performance?batch=sandbox", undefined, "student");
  assert.equal(result.status, 200);
  assert.equal(result.data.attempts.length, 0);
  assert.deepEqual(officialLinks("Jenkins"), ["https://www.jenkins.io/doc/"]);
  assert.deepEqual(officialLinks("Unmapped tool"), []);
});

test("courses attach a shared SOP and bulk release preserves private instructor restrictions", async () => {
  const { call, env } = await fixture();
  await env.DB.prepare(
    "INSERT INTO files(id,owner_id,name,mime,size,created) VALUES ('sop-file','owner','curriculum.pdf','application/pdf',10,'2026-11-19')",
  ).run();
  const course = await call("admin/save", {
    entity: "courses",
    values: {
      title: "Cloud Engineering",
      description: "A complete course",
      fee: 10000,
      currency: "INR",
      syllabus: JSON.stringify([{ title: "Git", detail: "Version control" }]),
      sop_file_id: "sop-file",
    },
  });
  assert.equal(course.status, 200);
  const sop = await env.DB.prepare(
    "SELECT * FROM content WHERE course_id=? AND kind='sop'",
  )
    .bind(course.data.id)
    .first();
  assert.equal(sop.file_id, "sop-file");
  assert.equal(sop.batch_id, null);
  const root = "root_folder_123456",
    source = await call("admin/automation/source", {
      batch_id: "sandbox",
      folder_input: "https://drive.google.com/drive/folders/" + root,
    });
  const claim = await call(
    "automation/claim",
    { source_id: source.data.id },
    "service",
  );
  const make = (id, name) => ({
    drive_file_id: id,
    name,
    source_path: "batch/notes",
    mime: "application/pdf",
    size: 0,
    revision: "1",
    url: "https://drive.google.com/file/d/" + id + "/view",
    ancestor_ids: [root],
  });
  const imported = await call(
    "automation/ingest",
    {
      run_id: claim.data.run_id,
      items: [
        make("file_student_1234", "Day1_notes.pdf"),
        make("file_teacher_1234", "Day1_answer_key.pdf"),
      ],
    },
    "service",
  );
  const ids = imported.data.items.map((i) => i.id);
  const released = await call("admin/automation/bulk-review", {
    ids,
    confirmed_student_safe: true,
    topic: "Git",
  });
  assert.equal(released.status, 200);
  assert.equal(released.data.results.filter((r) => r.ok).length, 1);
  assert.equal(released.data.results.filter((r) => !r.ok).length, 1);
  const leaked = await env.DB.prepare(
    "SELECT id FROM content WHERE title LIKE '%answer_key%'",
  ).first();
  assert.equal(leaked, null);
});
