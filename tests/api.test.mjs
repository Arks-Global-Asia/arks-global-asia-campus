import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { api, grade, publicQuestions } from "../server/api.js";
import { database, memoryBucket } from "../scripts/database.mjs";
const owner = { id: "owner", email: "owner@arks.test" },
  student = { id: "student", email: "student@arks.test" },
  outsider = { id: "outsider", email: "outsider@arks.test" };
async function campus() {
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    LOCAL_DEV_OWNER: "true",
  };
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
  const ownerFileRes = await api(request(owner), env);
  assert.equal(await ownerFileRes.text(), "my solution");
  assert.match(
    ownerFileRes.headers.get("Content-Security-Policy") || "",
    /sandbox/,
  );
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

test("custom domain and Azure SWA origins pass verifyOrigin and resolvePublicOrigin for OAuth, while evil origins and production header spoofing are rejected", async () => {
  const { env, call } = await campus();

  // Configure staff password so POST /api/auth/admin can be tested across origins
  await call(owner, "admin/password", {
    email: "head@arks.test",
    password: "head-admin-secure-password-123",
    name: "Head Admin",
    role: "admin",
  });

  for (const allowedOrigin of [
    "https://student-portal.arksglobalasia.cloud",
    "https://yellow-tree-0ceb4a400.3.azurestaticapps.net",
  ]) {
    const authRes = await api(
      new Request("https://internal-worker.test/api/auth/admin", {
        method: "POST",
        headers: {
          Origin: allowedOrigin,
          "X-Forwarded-Host": "student-portal.arksglobalasia.cloud",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "head@arks.test",
          password: "head-admin-secure-password-123",
        }),
      }),
      env,
    );
    assert.equal(authRes.status, 200);
    const authBody = await authRes.json();
    assert.equal(authBody.ok, true);
    assert.equal(authBody.role, "admin");
  }

  // Evil origin rejected with 403 Invalid request origin.
  const evilRes = await api(
    new Request("https://student-portal.arksglobalasia.cloud/api/auth/admin", {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "head@arks.test",
        password: "head-admin-secure-password-123",
      }),
    }),
    env,
  );
  assert.equal(evilRes.status, 403);
  assert.equal((await evilRes.json()).error, "Invalid request origin.");

  // Google OAuth start succeeds with both origins and X-Forwarded-Host
  env.GOOGLE_CLIENT_ID = "google-client-id";
  env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  for (const allowedOrigin of [
    "https://student-portal.arksglobalasia.cloud",
    "https://yellow-tree-0ceb4a400.3.azurestaticapps.net",
  ]) {
    const oauthStart = await api(
      new Request(allowedOrigin + "/api/auth/google/start", {
        headers: {
          Origin: allowedOrigin,
          "X-Forwarded-Host": new URL(allowedOrigin).host,
          "X-Forwarded-Proto": "https",
        },
      }),
      env,
    );
    assert.equal(oauthStart.status, 302);
    assert.ok(
      oauthStart.headers
        .get("Location")
        .includes(
          encodeURIComponent(allowedOrigin + "/api/auth/google/callback"),
        ),
    );
  }

  // Production environment without LOCAL_DEV_OWNER rejects oai-authenticated-user-* headers
  const prodEnv = { ...env, LOCAL_DEV_OWNER: undefined };
  const spoofed = await api(
    new Request("https://student-portal.arksglobalasia.cloud/api/bootstrap", {
      headers: {
        "oai-authenticated-user-id": owner.id,
        "oai-authenticated-user-email": owner.email,
      },
    }),
    prodEnv,
  );
  assert.equal(spoofed.status, 401);
});

test("3-role RBAC allows trainer password sign-in and academic actions, and blocks trainer from payments, courses, passwords, and role changes", async () => {
  const { env, call } = await campus();
  const trainerUser = { id: "trainer1", email: "trainer@arks.test" };

  // Head/Admin sets password for trainer account
  const setPw = await call(owner, "admin/password", {
    email: trainerUser.email,
    password: "trainer-secure-password-2026",
    name: "Lead Trainer",
    role: "trainer",
  });
  assert.equal(setPw.status, 200);
  assert.equal(setPw.data.role, "trainer");

  // Trainer signs in via POST /api/auth/admin in production mode (no LOCAL_DEV_OWNER)
  const prodEnv = { ...env, LOCAL_DEV_OWNER: undefined };
  const loginRes = await api(
    new Request("https://student-portal.arksglobalasia.cloud/api/auth/admin", {
      method: "POST",
      headers: {
        Origin: "https://student-portal.arksglobalasia.cloud",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: trainerUser.email,
        password: "trainer-secure-password-2026",
      }),
    }),
    prodEnv,
  );
  assert.equal(loginRes.status, 200);
  const loginJson = await loginRes.json();
  assert.equal(loginJson.role, "trainer");
  const trainerCookie = loginRes.headers.get("set-cookie").split(";")[0];

  // Trainer session cookie works for /api/bootstrap and /api/admin/data in production mode
  const bootCookieRes = await api(
    new Request("https://student-portal.arksglobalasia.cloud/api/bootstrap", {
      headers: { cookie: trainerCookie },
    }),
    prodEnv,
  );
  assert.equal(bootCookieRes.status, 200);
  assert.equal((await bootCookieRes.json()).user.role, "trainer");

  assert.equal((await call(trainerUser, "admin/data")).status, 200);
  assert.equal((await call(trainerUser, "admin/data")).data.payments.length, 0);

  // Trainer can schedule session series, create/edit content, complete live sessions, review labs, reply to tickets, and bulk invite students
  const seriesRes = await call(trainerUser, "admin/sessions", {
    batch_id: "sandbox",
    title: "Evening Class {n}",
    dates: ["2026-11-25T16:00:00Z"],
    url: "https://meet.google.com/evening-class",
  });
  assert.equal(seriesRes.status, 200);

  const createdLive = await call(trainerUser, "admin/save", {
    entity: "content",
    values: {
      course_id: "devops",
      batch_id: "sandbox",
      kind: "live",
      title: "Kubernetes Deep Dive",
      topic: "Kubernetes",
      topic_order: 4,
      url: "https://meet.google.com/k8s-live",
      published: 1,
    },
  });
  assert.equal(createdLive.status, 200);

  const completed = await call(trainerUser, "admin/complete-session", {
    session_id: createdLive.data.id,
    recording_url: "https://drive.google.com/file/d/rec123456789/view",
    advance_covered: true,
  });
  assert.equal(completed.status, 200);
  assert.ok(completed.data.recording_id);
  const updatedBatch = await env.DB.prepare(
    "SELECT covered FROM batches WHERE id='sandbox'",
  ).first();
  assert.equal(updatedBatch.covered, 4);

  const bulk = await call(trainerUser, "admin/bulk-invite", {
    batch_id: "sandbox",
    fee: 50000,
    csv: "learner1@arks.test,Learner One\nlearner2@arks.test,Learner Two,60000",
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.data.invited, 2);

  // Student submits lab and ticket; Trainer reviews lab and replies to ticket
  await call(student, "bootstrap");
  await call(owner, "admin/save", {
    entity: "invitations",
    values: { email: student.email, batch_id: "sandbox", fee: 50000 },
  });
  await call(student, "bootstrap");
  await call(student, "submissions", {
    batch_id: "sandbox",
    content_id: "lab-git",
    body: "kubectl apply -f deployment.yaml",
  });
  const subId = (await call(trainerUser, "admin/data")).data.submissions[0].id;
  assert.equal(
    (
      await call(trainerUser, "admin/review", {
        id: subId,
        status: "accepted",
        feedback: "Verified by Trainer.",
      })
    ).status,
    200,
  );
  const tkt = await call(student, "tickets", {
    batch_id: "sandbox",
    category: "academic",
    subject: "Pod crashloop",
    body: "Why is my pod restarting?",
  });
  assert.equal(
    (
      await call(trainerUser, "admin/reply", {
        id: tkt.data.id,
        reply: "Check container logs with kubectl logs --previous.",
        status: "resolved",
      })
    ).status,
    200,
  );

  // Record a payment as Head/Admin so we can verify trainer cannot record or delete payments
  const enrollment = (await call(student, "campus?batch=sandbox")).data
    .enrollment;
  assert.equal(
    (
      await call(owner, "admin/payment", {
        enrollment_id: enrollment.id,
        amount: 10000,
        reference: "HEAD-PAY-1",
        paid_at: "2026-11-20",
      })
    ).status,
    200,
  );
  const paymentRow = await env.DB.prepare("SELECT id FROM payments LIMIT 1").first();

  // Trainer is strictly blocked (403) from Head/Admin operations:
  // 1) /api/admin/payment
  assert.equal(
    (
      await call(trainerUser, "admin/payment", {
        enrollment_id: enrollment.id,
        amount: 5000,
        reference: "TRAINER-PAY-1",
        paid_at: "2026-11-21",
      })
    ).status,
    403,
  );
  // 2) /api/admin/role
  assert.equal(
    (
      await call(trainerUser, "admin/role", {
        id: student.id,
        role: "admin",
      })
    ).status,
    403,
  );
  // 3) /api/admin/password
  assert.equal(
    (
      await call(trainerUser, "admin/password", {
        email: "newstaff@arks.test",
        password: "very-long-secure-password-123",
        role: "trainer",
      })
    ).status,
    403,
  );
  // 4) /api/admin/access
  assert.equal(
    (
      await call(trainerUser, "admin/access", {
        user_id: student.id,
        active: false,
      })
    ).status,
    403,
  );
  // 5) Creating/modifying courses
  assert.equal(
    (
      await call(trainerUser, "admin/save", {
        entity: "courses",
        values: {
          title: "Unauthorized Course",
          description: "Desc",
          fee: 100,
          currency: "INR",
          syllabus: JSON.stringify([{ title: "T1", detail: "D1" }]),
        },
      })
    ).status,
    403,
  );
  // 6) Inviting admin/trainer roles
  assert.equal(
    (
      await call(trainerUser, "admin/save", {
        entity: "invitations",
        values: {
          email: "escalate@arks.test",
          batch_id: "sandbox",
          role: "admin",
          fee: 0,
        },
      })
    ).status,
    403,
  );
  // 7) Deleting courses or payments
  assert.equal(
    (
      await call(trainerUser, "admin/delete", {
        entity: "courses",
        id: "devops",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(trainerUser, "admin/delete", {
        entity: "payments",
        id: paymentRow.id,
      })
    ).status,
    403,
  );
});

test("test save preserves batch_id/source_ids/ai_generated, supports image resources, threaded tickets, grade override, retake and delete", async () => {
  const { env, call } = await campus();
  await env.DB.prepare(
    "INSERT INTO tests (id,course_id,title,kind,topic_order,duration,batch_id,source_ids,ai_generated,questions,published) VALUES ('ai-quiz','devops','AI Daily','daily',1,30,'sandbox','[\"notes-git\"]',1,?,0)",
  )
    .bind(
      JSON.stringify([
        {
          prompt: "What does git status show?",
          options: ["Working tree status", "Remote branches"],
          answer: 0,
          explanation: "Shows working tree status.",
        },
      ]),
    )
    .run();

  const savedTest = await call(owner, "admin/save", {
    entity: "tests",
    values: {
      id: "ai-quiz",
      course_id: "devops",
      title: "AI Daily (Published)",
      kind: "daily",
      topic_order: 1,
      duration: 30,
      published: 1,
      questions: JSON.stringify([
        {
          prompt: "What does git status show?",
          options: ["Working tree status", "Remote branches"],
          answer: 0,
          explanation: "Shows working tree status.",
        },
      ]),
    },
  });
  assert.equal(savedTest.status, 200);
  const row = await env.DB.prepare("SELECT * FROM tests WHERE id='ai-quiz'").first();
  assert.equal(row.batch_id, "sandbox");
  assert.equal(row.ai_generated, 1);
  assert.equal(row.source_ids, '["notes-git"]');

  // Image content creation & self-completion
  const imgContent = await call(owner, "admin/save", {
    entity: "content",
    values: {
      course_id: "devops",
      batch_id: "sandbox",
      kind: "image",
      title: "VPC Architecture Diagram",
      topic: "Networking",
      topic_order: 1,
      published: 1,
    },
  });
  assert.equal(imgContent.status, 200);
  assert.equal(
    (
      await call(owner, "complete", {
        batch_id: "sandbox",
        content_id: imgContent.data.id,
        complete: true,
      })
    ).status,
    200,
  );

  // Start, submit, manual grade override, and grant retake
  const started = await call(owner, "tests/start", {
    batch_id: "sandbox",
    test_id: "ai-quiz",
  });
  await call(owner, "tests/submit", {
    attempt_id: started.data.id,
    answers: [1],
  });
  assert.equal(
    (
      await call(owner, "admin/attempt-action", {
        attempt_id: started.data.id,
        mode: "grade",
        score: 88,
      })
    ).status,
    200,
  );
  assert.equal((await call(owner, "results/" + started.data.id)).data.score, 88);

  assert.equal(
    (
      await call(owner, "admin/attempt-action", {
        attempt_id: started.data.id,
        mode: "reset",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(owner, "tests/start", {
        batch_id: "sandbox",
        test_id: "ai-quiz",
      })
    ).status,
    200,
  );

  // Threaded tickets with category
  const createdTicket = await call(owner, "tickets", {
    batch_id: "sandbox",
    category: "lab",
    subject: "Docker volume permission",
    body: "Container cannot write to bind mount.",
  });
  assert.equal(createdTicket.status, 200);
  await call(owner, "admin/reply", {
    id: createdTicket.data.id,
    reply: "Check UID/GID mapping or :Z flag.",
    status: "open",
  });
  await call(owner, "tickets", {
    ticket_id: createdTicket.data.id,
    body: "That fixed it, thank you!",
  });
  const ticketRow = await env.DB.prepare("SELECT * FROM tickets WHERE id=?")
    .bind(createdTicket.data.id)
    .first();
  assert.equal(ticketRow.category, "lab");
  assert.equal(JSON.parse(ticketRow.messages).length, 3);

  // Safe entity deletion
  assert.equal(
    (
      await call(owner, "admin/delete", {
        entity: "content",
        id: imgContent.data.id,
      })
    ).status,
    200,
  );
});

test("Azure SWA Managed Function gateway translates SQLite to PostgreSQL, handles x-ms-original-url and APP_ORIGIN, and maps responses", async () => {
  const {
    default: gateway,
    translateSqliteToPg,
    buildFetchRequest,
    PG_SCHEMA_MIGRATIONS,
  } = await import("../server/swa-gateway.js");

  const require = createRequire(import.meta.url);
  const cjsGateway = require("../api/gateway/index.js");
  assert.equal(typeof cjsGateway, "function");

  // 1. Verify SQL translator handles INSERT OR IGNORE and ? placeholders outside single quotes
  assert.equal(
    translateSqliteToPg(
      "INSERT OR IGNORE INTO settings (key,value) VALUES ('owner',?)",
    ),
    "INSERT INTO settings (key,value) VALUES ('owner',$1) ON CONFLICT DO NOTHING",
  );
  assert.equal(
    translateSqliteToPg(
      "SELECT * FROM content WHERE title='What is Git?' AND course_id=? AND (batch_id IS NULL OR batch_id=?)",
    ),
    "SELECT * FROM content WHERE title='What is Git?' AND course_id=$1 AND (batch_id IS NULL OR batch_id=$2)",
  );
  assert.equal(
    translateSqliteToPg(
      "INSERT INTO admin_credentials VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash",
    ),
    "INSERT INTO admin_credentials VALUES ($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash",
  );
  assert.ok(PG_SCHEMA_MIGRATIONS.length >= 21);

  // 2. Verify buildFetchRequest preserves x-ms-original-url origin, segments, and query string
  const fetchReq = buildFetchRequest(
    {
      method: "GET",
      headers: {
        "x-ms-original-url":
          "https://student-portal.arksglobalasia.cloud/api/campus?batch=sandbox",
        host: "internal-functions-host.azurewebsites.net",
      },
      query: { batch: "sandbox" },
    },
    { bindingData: { segments: "campus" } },
  );
  assert.equal(
    fetchReq.url,
    "https://student-portal.arksglobalasia.cloud/api/campus?batch=sandbox",
  );

  // 3. Verify full gateway invocation for /api/auth/config and /api/auth/admin with APP_ORIGIN and x-ms-original-url (including CommonJS require("../api/gateway/index.js"))
  const { env, call } = await campus();
  await call(owner, "admin/password", {
    email: "swa-head@arks.test",
    password: "swa-head-secure-password-2026",
    name: "SWA Head Admin",
    role: "admin",
  });

  const configCtx = {
    bindingData: { segments: "auth/config" },
    log: { error: () => {} },
  };
  await cjsGateway(
    configCtx,
    {
      method: "GET",
      headers: {
        "x-ms-original-url":
          "https://student-portal.arksglobalasia.cloud/api/auth/config",
        host: "internal-swa.azurewebsites.net",
      },
    },
    {
      ...env,
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsecret",
      APP_ORIGIN: "https://student-portal.arksglobalasia.cloud",
    },
  );
  assert.equal(configCtx.res.status, 200);
  const cfgJson = JSON.parse(String(configCtx.res.body));
  assert.equal(cfgJson.google_ready, true);
  assert.equal(
    cfgJson.public_origin,
    "https://student-portal.arksglobalasia.cloud",
  );

  const loginCtx = {
    bindingData: { segments: "auth/admin" },
    log: { error: () => {} },
  };
  await gateway(
    loginCtx,
    {
      method: "POST",
      headers: {
        "x-ms-original-url":
          "https://student-portal.arksglobalasia.cloud/api/auth/admin",
        Origin: "https://student-portal.arksglobalasia.cloud",
        "Content-Type": "application/json",
      },
      rawBody: JSON.stringify({
        email: "swa-head@arks.test",
        password: "swa-head-secure-password-2026",
      }),
    },
    {
      ...env,
      LOCAL_DEV_OWNER: undefined,
      APP_ORIGIN: "https://student-portal.arksglobalasia.cloud",
    },
  );
  assert.equal(loginCtx.res.status, 200);
  const loginBody = JSON.parse(String(loginCtx.res.body));
  assert.equal(loginBody.ok, true);
  assert.equal(loginBody.role, "admin");
  assert.match(String(loginCtx.res.headers["Set-Cookie"] || ""), /arks_session=/);
});

test("campus content includes file_name and file_mime, and /api/files serves PDF/image/SVG/PPTX with proper inline/attachment headers", async () => {
  const { env, call } = await campus();
  async function upload(name, body, type) {
    const form = new FormData();
    form.set("file", new File([body], name, { type }));
    const res = await api(
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
    assert.equal(res.status, 200);
    return await res.json();
  }

  const pdfFile = await upload("k8s-slides.pdf", "%PDF-1.4", "application/pdf");
  const pngFile = await upload("arch-diagram.png", "pngbytes", "image/png");
  const svgFile = await upload(
    "flow.svg",
    "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    "image/svg+xml",
  );
  const pptxFile = await upload(
    "deck.pptx",
    "pptxbytes",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );

  await call(owner, "admin/save", {
    entity: "content",
    values: {
      course_id: "devops",
      batch_id: "sandbox",
      kind: "slides",
      title: "Kubernetes Slides",
      topic: "Kubernetes",
      topic_order: 2,
      file_id: pdfFile.id,
      published: 1,
    },
  });

  const campusRes = await call(owner, "campus?batch=sandbox");
  const slideRow = campusRes.data.content.find(
    (c) => c.title === "Kubernetes Slides",
  );
  assert.ok(slideRow);
  assert.equal(slideRow.file_name, "k8s-slides.pdf");
  assert.equal(slideRow.file_mime, "application/pdf");

  const fetchFile = (fid, query = "") =>
    api(
      new Request(`https://campus.test/api/files/${fid}${query}`, {
        headers: {
          "oai-authenticated-user-id": owner.id,
          "oai-authenticated-user-email": owner.email,
        },
      }),
      env,
    );

  // Inline PDF: application/pdf, inline, NO sandbox in CSP, has frame-ancestors 'self'
  const pdfInline = await fetchFile(pdfFile.id, "?inline=1");
  assert.equal(pdfInline.status, 200);
  assert.equal(pdfInline.headers.get("Content-Type"), "application/pdf");
  assert.match(pdfInline.headers.get("Content-Disposition") || "", /^inline;/);
  const pdfCsp = pdfInline.headers.get("Content-Security-Policy") || "";
  assert.doesNotMatch(pdfCsp, /sandbox/);
  assert.match(pdfCsp, /frame-ancestors 'self'/);

  // Download PDF (no inline): attachment
  const pdfDownload = await fetchFile(pdfFile.id);
  assert.match(
    pdfDownload.headers.get("Content-Disposition") || "",
    /^attachment;/,
  );

  // Inline PNG: image/png, inline
  const pngInline = await fetchFile(pngFile.id, "?inline=1");
  assert.equal(pngInline.headers.get("Content-Type"), "image/png");
  assert.match(pngInline.headers.get("Content-Disposition") || "", /^inline;/);

  // Inline SVG: image/svg+xml, inline, MUST keep sandbox CSP
  const svgInline = await fetchFile(svgFile.id, "?inline=1");
  assert.equal(svgInline.headers.get("Content-Type"), "image/svg+xml");
  assert.match(svgInline.headers.get("Content-Disposition") || "", /^inline;/);
  assert.match(
    svgInline.headers.get("Content-Security-Policy") || "",
    /sandbox/,
  );

  // PPTX: proper presentation MIME and attachment disposition
  const pptxRes = await fetchFile(pptxFile.id);
  assert.equal(
    pptxRes.headers.get("Content-Type"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.match(pptxRes.headers.get("Content-Disposition") || "", /^attachment;/);
});

test("POST /api/admin/users enforces RBAC, creates student/trainer/admin with optional staff password, and rejects duplicate emails", async () => {
  const { env, call } = await campus();

  // Head/Admin creates a student (no batch required)
  const stuRes = await call(owner, "admin/users", {
    name: "Aarav Verma",
    email: "Aarav.Verma@arks.test",
    phone: "+91-9876543210",
    role: "student",
  });
  assert.equal(stuRes.status, 200);
  assert.equal(stuRes.data.ok, true);
  assert.equal(stuRes.data.role, "student");
  const stuRow = await env.DB.prepare("SELECT * FROM users WHERE id=?")
    .bind(stuRes.data.id)
    .first();
  assert.equal(stuRow.email, "aarav.verma@arks.test");
  assert.equal(stuRow.role, "student");
  assert.equal(stuRow.active, 1);
  assert.equal(stuRow.onboarded, 0);

  // Duplicate email returns 409
  const dupRes = await call(owner, "admin/users", {
    name: "Aarav Duplicate",
    email: "aarav.verma@arks.test",
    role: "student",
  });
  assert.equal(dupRes.status, 409);

  // Head/Admin creates a trainer with password for immediate sign-in
  const trRes = await call(owner, "admin/users", {
    name: "Priya Nair",
    email: "priya.trainer@arks.test",
    phone: "9988776655",
    role: "trainer",
    password: "priya-trainer-secure-pass-2026",
  });
  assert.equal(trRes.status, 200);
  assert.equal(trRes.data.role, "trainer");

  // Trainer can sign in immediately via /api/auth/admin
  const prodEnv = { ...env, LOCAL_DEV_OWNER: undefined };
  const loginRes = await api(
    new Request("https://student-portal.arksglobalasia.cloud/api/auth/admin", {
      method: "POST",
      headers: {
        Origin: "https://student-portal.arksglobalasia.cloud",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "priya.trainer@arks.test",
        password: "priya-trainer-secure-pass-2026",
      }),
    }),
    prodEnv,
  );
  assert.equal(loginRes.status, 200);
  assert.equal((await loginRes.json()).role, "trainer");

  // Head/Admin creates another admin
  const admRes = await call(owner, "admin/users", {
    name: "Vikram Head",
    email: "vikram.admin@arks.test",
    role: "admin",
  });
  assert.equal(admRes.status, 200);
  assert.equal(admRes.data.role, "admin");

  // Trainer can create a student (200), but is blocked (403) from creating trainer or admin
  const trainerActor = { id: trRes.data.id, email: "priya.trainer@arks.test" };
  const trCreateStu = await call(trainerActor, "admin/users", {
    name: "Diya Patel",
    email: "diya.patel@arks.test",
    role: "student",
  });
  assert.equal(trCreateStu.status, 200);

  assert.equal(
    (
      await call(trainerActor, "admin/users", {
        name: "Unauthorized Trainer",
        email: "unauth.tr@arks.test",
        role: "trainer",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(trainerActor, "admin/users", {
        name: "Unauthorized Admin",
        email: "unauth.adm@arks.test",
        role: "admin",
      })
    ).status,
    403,
  );

  // Student is blocked (403) from creating users
  assert.equal(
    (
      await call(student, "admin/users", {
        name: "Blocked User",
        email: "blocked@arks.test",
        role: "student",
      })
    ).status,
    403,
  );
});

test("POST /api/admin/group-members adds already-created users to a Batch Group, auto-enrolls them, removes members, and blocks students", async () => {
  const { env, call } = await campus();

  // Create two students first
  const s1 = await call(owner, "admin/users", {
    name: "Student One",
    email: "s1@arks.test",
    role: "student",
  });
  const s2 = await call(owner, "admin/users", {
    name: "Student Two",
    email: "s2@arks.test",
    role: "student",
  });
  assert.equal(s1.status, 200);
  assert.equal(s2.status, 200);

  // Create an empty Batch Group for sandbox
  const grp = await call(owner, "admin/group", {
    batch_id: "sandbox",
    name: "Sandbox Cohort A",
    members: "",
  });
  assert.equal(grp.status, 200);
  const groupId = grp.data.id;

  // Add both already-created students by user_ids
  const addRes = await call(owner, "admin/group-members", {
    group_id: groupId,
    action: "add",
    user_ids: [s1.data.id, s2.data.id],
    fee: 250000,
  });
  assert.equal(addRes.status, 200);
  assert.equal(addRes.data.ok, true);
  assert.equal(addRes.data.count, 2);

  // Verify group_members, enrollments, and invitations
  const gmRows = (
    await env.DB.prepare(
      "SELECT email FROM group_members WHERE group_id=? ORDER BY email",
    )
      .bind(groupId)
      .all()
  ).results;
  assert.deepEqual(
    gmRows.map((r) => r.email),
    ["s1@arks.test", "s2@arks.test"],
  );

  const enr1 = await env.DB.prepare(
    "SELECT * FROM enrollments WHERE user_id=? AND batch_id='sandbox'",
  )
    .bind(s1.data.id)
    .first();
  assert.ok(enr1, "Expected Student One to be auto-enrolled in sandbox");
  assert.equal(enr1.fee, 250000);

  const inv1 = await env.DB.prepare(
    "SELECT * FROM invitations WHERE email='s1@arks.test' AND batch_id='sandbox'",
  ).first();
  assert.ok(inv1, "Expected invitation row for Google OAuth recognition");

  // Remove Student Two from the Batch Group
  const remRes = await call(owner, "admin/group-members", {
    group_id: groupId,
    action: "remove",
    emails: ["s2@arks.test"],
  });
  assert.equal(remRes.status, 200);
  assert.equal(remRes.data.count, 1);

  const gmAfter = (
    await env.DB.prepare("SELECT email FROM group_members WHERE group_id=?")
      .bind(groupId)
      .all()
  ).results;
  assert.deepEqual(
    gmAfter.map((r) => r.email),
    ["s1@arks.test"],
  );

  // Student is blocked (403)
  assert.equal(
    (
      await call(student, "admin/group-members", {
        group_id: groupId,
        action: "add",
        user_ids: [s2.data.id],
      })
    ).status,
    403,
  );

  // Unknown group returns 404
  assert.equal(
    (
      await call(owner, "admin/group-members", {
        group_id: "non-existent-group",
        action: "add",
        user_ids: [s1.data.id],
      })
    ).status,
    404,
  );
});
