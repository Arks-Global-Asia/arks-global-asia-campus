import test from "node:test";
import assert from "node:assert/strict";
import { api, grade, publicQuestions } from "../server/api.js";
import { database, memoryBucket } from "../scripts/database.mjs";
const owner = { id: "owner", email: "owner@arks.test" },
  student = { id: "student", email: "student@arks.test" },
  outsider = { id: "outsider", email: "outsider@arks.test" };
async function campus() {
  const env = { DB: await database(), BUCKET: memoryBucket() };
  async function call(user, path, body) {
    const headers = {};
    if (user) {
      headers["oai-authenticated-user-id"] = user.id;
      headers["oai-authenticated-user-email"] = user.email;
    }
    if (body) headers["Content-Type"] = "application/json";
    const response = await api(
      new Request("https://campus.test/api/" + path, {
        headers,
        method: body ? "POST" : "GET",
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return { status: response.status, data: await response.json() };
  }
  await call(owner, "bootstrap");
  return { env, call };
}
test("authentication and role checks protect student and admin records", async () => {
  const { call } = await campus();
  assert.equal((await call(null, "bootstrap")).status, 401);
  assert.equal((await call(student, "admin/data")).status, 403);
  assert.equal((await call(student, "campus?batch=sandbox")).status, 403);
  assert.equal((await call(student, "bootstrap")).data.user.role, "student");
});
test("enrollment, profile, resource progress and durable batch isolation", async () => {
  const { call } = await campus();
  await call(owner, "admin/save", {
    entity: "invitations",
    values: {
      email: student.email,
      batch_id: "sandbox",
      role: "student",
      fee: 100000,
    },
  });
  const b = await call(student, "bootstrap");
  assert.equal(b.data.batches.length, 1);
  assert.equal(
    (
      await call(student, "profile", {
        name: "Maya Shah",
        phone: "12345",
        goal: "DevOps engineer",
      })
    ).status,
    200,
  );
  await call(student, "complete", {
    batch_id: "sandbox",
    content_id: "notes-git",
    complete: true,
  });
  let data = (await call(student, "campus?batch=sandbox")).data;
  assert.equal(data.completions.length, 1);
  assert.equal(data.enrollment.fee, 100000);
  assert.equal(
    (
      await call(outsider, "complete", {
        batch_id: "sandbox",
        content_id: "notes-git",
        complete: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(student, "complete", {
        batch_id: "sandbox",
        content_id: "lab-git",
        complete: true,
      })
    ).status,
    400,
  );
});
test("lab feedback and support queries persist and remain scoped", async () => {
  const { call } = await campus();
  await call(owner, "admin/save", {
    entity: "invitations",
    values: { email: student.email, batch_id: "sandbox", fee: 0 },
  });
  await call(student, "bootstrap");
  await call(student, "submissions", {
    batch_id: "sandbox",
    content_id: "lab-git",
    body: "git switch -c feature; resolved conflict and merged",
  });
  const a = (await call(owner, "admin/data")).data;
  await call(owner, "admin/review", {
    id: a.submissions[0].id,
    status: "accepted",
    feedback: "Good explanation.",
  });
  await call(student, "tickets", {
    batch_id: "sandbox",
    subject: "Need help",
    body: "How do I squash commits?",
  });
  const q = (await call(owner, "admin/data")).data.tickets[0];
  await call(owner, "admin/reply", {
    id: q.id,
    reply: "Use git rebase -i for your local commits.",
    status: "resolved",
  });
  const d = (await call(student, "campus?batch=sandbox")).data;
  assert.equal(d.submissions[0].feedback, "Good explanation.");
  assert.equal(d.completions[0].content_id, "lab-git");
  assert.equal(d.tickets[0].status, "resolved");
});
test("assessment answers stay server-side, results are graded and submissions idempotent", async () => {
  const { call } = await campus();
  const started = await call(owner, "tests/start", {
    test_id: "daily-git",
    batch_id: "sandbox",
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.questions[0].answer, undefined);
  assert.equal(started.data.questions[0].explanation, undefined);
  const result = await call(owner, "tests/submit", {
    attempt_id: started.data.id,
    answers: [0, 1, 2],
  });
  assert.equal(result.data.score, 100);
  const duplicate = await call(owner, "tests/submit", {
    attempt_id: started.data.id,
    answers: [1, 1, 1],
  });
  assert.equal(duplicate.data.score, 100);
  assert.equal((await call(student, "results/" + started.data.id)).status, 404);
  assert.equal(
    (
      await call(owner, "tests/start", {
        test_id: "daily-git",
        batch_id: "sandbox",
      })
    ).status,
    400,
  );
});
test("future tests stay locked; active attempts resume; snapshots survive test edits", async () => {
  const { call } = await campus();
  const a = await call(owner, "tests/start", {
      test_id: "daily-git",
      batch_id: "sandbox",
    }),
    b = await call(owner, "tests/start", {
      test_id: "daily-git",
      batch_id: "sandbox",
    });
  assert.equal(a.data.id, b.data.id);
  await call(owner, "admin/save", {
    entity: "tests",
    values: {
      id: "future",
      course_id: "devops",
      title: "Later",
      kind: "monthly",
      topic_order: 8,
      duration: 5,
      published: 1,
      questions: JSON.stringify([
        { prompt: "Test?", options: ["A", "B"], answer: 1 },
      ]),
    },
  });
  assert.equal(
    (
      await call(owner, "tests/start", {
        test_id: "future",
        batch_id: "sandbox",
      })
    ).status,
    403,
  );
  await call(owner, "admin/save", {
    entity: "tests",
    values: {
      id: "daily-git",
      course_id: "devops",
      title: "Edited",
      kind: "daily",
      topic_order: 2,
      duration: 5,
      published: 1,
      questions: JSON.stringify([
        { prompt: "Changed?", options: ["A", "B"], answer: 1 },
      ]),
    },
  });
  assert.equal(
    (
      await call(owner, "tests/submit", {
        attempt_id: a.data.id,
        answers: [0, 1, 2],
      })
    ).data.total,
    100,
  );
});
test("payments require admin and reject duplicate references and overpayment", async () => {
  const { call } = await campus();
  await call(owner, "admin/save", {
    entity: "invitations",
    values: { email: student.email, batch_id: "sandbox", fee: 10000 },
  });
  await call(student, "bootstrap");
  const e = (await call(student, "campus?batch=sandbox")).data.enrollment;
  const p = {
    enrollment_id: e.id,
    amount: 6000,
    reference: "BANK-001",
    paid_at: "2026-11-15",
  };
  assert.equal((await call(student, "admin/payment", p)).status, 403);
  assert.equal((await call(owner, "admin/payment", p)).status, 200);
  assert.equal((await call(owner, "admin/payment", p)).status, 400);
  assert.equal(
    (await call(owner, "admin/payment", { ...p, reference: "BANK-002" }))
      .status,
    400,
  );
  assert.equal(
    (await call(student, "campus?batch=sandbox")).data.payments.length,
    1,
  );
});
test("unsafe URLs, mismatched course scopes and foreign files are rejected", async () => {
  const { call } = await campus();
  const c = {
    course_id: "devops",
    title: "Bad resource",
    kind: "notes",
    topic: "Git",
    topic_order: 1,
    url: "javascript:alert(1)",
    published: 1,
  };
  assert.equal(
    (await call(owner, "admin/save", { entity: "content", values: c })).status,
    400,
  );
  assert.equal(
    (
      await call(owner, "admin/save", {
        entity: "content",
        values: { ...c, url: "https://example.com", file_id: "foreign" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(owner, "admin/save", {
        entity: "invitations",
        values: { email: "bad", batch_id: "sandbox", fee: 0 },
      })
    ).status,
    400,
  );
});
test("uploads are durable and private, with size/type validation", async () => {
  const { env, call } = await campus();
  const form = new FormData();
  form.set(
    "file",
    new File(["my solution"], "solution.txt", { type: "text/plain" }),
  );
  const r = await api(
    new Request("https://campus.test/api/upload", {
      method: "POST",
      headers: {
        "oai-authenticated-user-id": owner.id,
        "oai-authenticated-user-email": owner.email,
      },
      body: form,
    }),
    env,
  );
  assert.equal(r.status, 200);
  const f = await r.json();
  const request = (user) =>
    new Request("https://campus.test/api/files/" + f.id, {
      headers: {
        "oai-authenticated-user-id": user.id,
        "oai-authenticated-user-email": user.email,
      },
    });
  assert.equal(await (await api(request(owner), env)).text(), "my solution");
  assert.equal((await api(request(student), env)).status, 403);
});
test("cross-origin mutation is rejected", async () => {
  const { env } = await campus();
  const r = await api(
    new Request("https://campus.test/api/profile", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        "Content-Type": "application/json",
        "oai-authenticated-user-id": owner.id,
        "oai-authenticated-user-email": owner.email,
      },
      body: JSON.stringify({ name: "Changed" }),
    }),
    env,
  );
  assert.equal(r.status, 403);
});
