import {
  validQuestion,
  normalizeQuestions,
  publicQuestion,
  validAnswer,
  written,
  objectiveCorrect,
} from "../shared/assessment.js";
import { member, admin, staff, isStaff, verifyOrigin } from "./common.js";
import { authRoutes, sessionUser } from "./auth.js";
import { featureRoutes, queueJob, wakeEngine, sanitizeSummary } from "./features.js";
import {
  serviceAutomation,
  adminAutomation,
  saveSource,
} from "./automation.js";
import { seed } from "./seed.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (s, m) => {
    throw new HttpError(s, m);
  },
  id = () => crypto.randomUUID(),
  now = () => new Date().toISOString();
const json = (data, status = 200, extraHeaders = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
const rows = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
const one = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first();
const run = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();
const required = (v, name, max = 200) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, `${name} is required (maximum ${max} characters).`);
  return v.trim();
};
const integer = (v, name, min = 0, max = 100000000) => {
  v = Number(v);
  if (!Number.isSafeInteger(v) || v < min || v > max)
    fail(400, `Invalid ${name}.`);
  return v;
};
const url = (v) => {
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") throw 0;
    return u.href;
  } catch {
    fail(400, "Use a valid HTTPS URL.");
  }
};
export function grade(questions, answers) {
  return questions.reduce(
    (s, q, i) => s + (answers[i] === q.answer ? 1 : 0),
    0,
  );
}
export function publicQuestions(qs) {
  return qs.map(publicQuestion);
}
async function log(db, u, action, entity) {
  await run(
    db,
    "INSERT INTO audit (id,actor,action,entity,created) VALUES (?,?,?,?,?)",
    id(),
    u.id,
    action,
    entity,
    now(),
  );
}
async function visibleContent(db, u, cid, batch) {
  const b = await member(db, u, batch);
  const c = await one(db, "SELECT * FROM content WHERE id=?", cid);
  if (
    !c ||
    c.course_id !== b.course_id ||
    (c.batch_id && c.batch_id !== batch) ||
    (!c.published && !isStaff(u))
  )
    fail(404, "Resource not found.");
  return c;
}
async function identity(req, db, env) {
  const signedIn = await sessionUser(req, env);
  if (signedIn) return signedIn;
  if (env.AUTH_MODE === "google" || env.LOCAL_DEV_OWNER !== "true")
    fail(401, "Sign in to access your campus.");
  const uid = req.headers.get("oai-authenticated-user-id"),
    email = req.headers.get("oai-authenticated-user-email")?.toLowerCase();
  if (!uid || !email) fail(401, "Sign in to access your campus.");
  await run(
    db,
    "INSERT OR IGNORE INTO settings (key,value) VALUES ('owner',?)",
    uid,
  );
  const owner = await one(db, "SELECT value FROM settings WHERE key='owner'");
  let name =
    req.headers.get("oai-authenticated-user-full-name") || email.split("@")[0];
  if (
    req.headers.get("oai-authenticated-user-full-name-encoding") ===
    "percent-encoded-utf-8"
  ) {
    try {
      name = decodeURIComponent(name);
    } catch {}
  }
  await run(
    db,
    "INSERT OR IGNORE INTO users (id,email,name,role,created) VALUES (?,?,?,?,?)",
    uid,
    email,
    name,
    owner.value === uid ? "admin" : "student",
    now(),
  );
  let u =
    (await one(db, "SELECT * FROM users WHERE id=?", uid)) ||
    (await one(db, "SELECT * FROM users WHERE email=?", email));
  const resolvedId = u.id;
  const invites = await rows(
    db,
    "SELECT * FROM invitations WHERE email=?",
    email,
  );
  for (const invite of invites) {
    await run(
      db,
      "INSERT OR IGNORE INTO enrollments (id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
      id(),
      resolvedId,
      invite.batch_id,
      invite.fee,
      now(),
    );
    if (invite.role === "admin")
      await run(db, "UPDATE users SET role='admin' WHERE id=?", resolvedId);
    else if (invite.role === "trainer" && u.role !== "admin")
      await run(db, "UPDATE users SET role='trainer' WHERE id=?", resolvedId);
  }
  u = await one(db, "SELECT * FROM users WHERE id=?", resolvedId);
  if (!u || !u.active) fail(403, "Your account is disabled.");
  return u;
}
export async function api(req, env) {
  try {
    return await handle(req, env);
  } catch (e) {
    if (e instanceof SyntaxError)
      e = new HttpError(400, "Invalid request data.");
    if (!e.status) console.error(e);
    const headers = !e.status
      ? { "X-Arks-Err": String(e?.code || e?.name || "ERR").slice(0, 32) }
      : {};
    return json(
      {
        error: e.status
          ? e.message
          : "The request could not be completed. Please try again.",
      },
      e.status || 500,
      headers,
    );
  }
}
async function handle(req, env) {
  const p = new URL(req.url).pathname,
    db = env.DB;
  if (!db) fail(503, "Database is not configured.");
  verifyOrigin(req, env);
  if (p.startsWith("/api/automation/")) return serviceAutomation(req, env);
  if (p.startsWith("/api/auth/")) {
    const response = await authRoutes(req, env);
    if (response) return response;
    fail(404, "Authentication endpoint not found.");
  }
  const u = await identity(req, db, env);
  const enhanced = await featureRoutes(req, env, u);
  if (enhanced) return enhanced;
  if (p.startsWith("/api/admin/automation/"))
    return adminAutomation(req, env, u);
  if (p === "/api/bootstrap" && req.method === "GET") {
    if (
      isStaff(u) &&
      !(await one(db, "SELECT value FROM settings WHERE key='seeded'"))
    ) {
      await seed(db);
      await run(
        db,
        "INSERT OR IGNORE INTO settings (key,value) VALUES ('seeded','1')",
      );
      await run(
        db,
        "INSERT OR IGNORE INTO enrollments (id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
        id(),
        u.id,
        "sandbox",
        0,
        now(),
      );
    }
    let batches = isStaff(u)
      ? await rows(db, "SELECT * FROM batches ORDER BY start_date DESC")
      : await rows(
          db,
          "SELECT b.* FROM batches b JOIN enrollments e ON e.batch_id=b.id WHERE e.user_id=? ORDER BY b.start_date DESC",
          u.id,
        );
    const courses = isStaff(u)
      ? await rows(db, "SELECT * FROM courses")
      : await rows(
          db,
          "SELECT DISTINCT c.* FROM courses c JOIN batches b ON b.course_id=c.id JOIN enrollments e ON e.batch_id=b.id WHERE e.user_id=?",
          u.id,
        );
    if (!isStaff(u)) {
      const permitted = [];
      for (const b of batches) {
        try {
          await member(db, u, b.id);
          permitted.push(b);
        } catch {}
      }
      batches = permitted;
    }
    return json({ user: u, batches, courses });
  }
  if (p === "/api/profile" && req.method === "POST") {
    const d = await req.json();
    await run(
      db,
      "UPDATE users SET name=?,phone=?,goal=?,onboarded=1 WHERE id=?",
      required(d.name, "Name", 100),
      String(d.phone || "").slice(0, 30),
      String(d.goal || "").slice(0, 1000),
      u.id,
    );
    return json({ ok: true });
  }
  if (p === "/api/campus" && req.method === "GET") {
    const batch = new URL(req.url).searchParams.get("batch");
    const b = await member(db, u, batch);
    const content = await rows(
      db,
      "SELECT c.*, f.name AS file_name, f.mime AS file_mime FROM content c LEFT JOIN files f ON f.id = c.file_id WHERE c.course_id=? AND (c.batch_id IS NULL OR c.batch_id=?) AND c.published=1 ORDER BY c.topic_order, c.created",
      b.course_id,
      batch,
    );
    const tests = await rows(
      db,
      "SELECT id,title,kind,topic_order,duration,ai_generated,batch_id FROM tests WHERE course_id=? AND published=1 AND (batch_id IS NULL OR batch_id=?)",
      b.course_id,
      batch,
    );
    return json({
      content: content.map((c) =>
        c.kind === "test_link" && c.topic_order > b.covered
          ? { ...c, url: "", file_id: null }
          : c,
      ),
      tests: tests.map((t) => ({ ...t, locked: t.topic_order > b.covered })),
      completions: await rows(
        db,
        "SELECT * FROM completions WHERE user_id=? AND batch_id=?",
        u.id,
        batch,
      ),
      submissions: await rows(
        db,
        "SELECT * FROM submissions WHERE user_id=? AND batch_id=? ORDER BY created DESC",
        u.id,
        batch,
      ),
      tickets: await rows(
        db,
        "SELECT * FROM tickets WHERE user_id=? AND batch_id=? ORDER BY created DESC",
        u.id,
        batch,
      ),
      attempts: await rows(
        db,
        "SELECT id,test_id,started,submitted,score,total,grading_status,summary FROM attempts WHERE user_id=? AND batch_id=? ORDER BY started DESC",
        u.id,
        batch,
      ),
      enrollment: await one(
        db,
        "SELECT * FROM enrollments WHERE user_id=? AND batch_id=?",
        u.id,
        batch,
      ),
      payments: await rows(
        db,
        "SELECT p.* FROM payments p JOIN enrollments e ON e.id=p.enrollment_id WHERE e.user_id=? AND e.batch_id=? ORDER BY paid_at DESC",
        u.id,
        batch,
      ),
    });
  }
  if (p === "/api/complete" && req.method === "POST") {
    const d = await req.json();
    const c = await visibleContent(db, u, d.content_id, d.batch_id);
    if (!["notes", "slides", "recording", "guide", "image"].includes(c.kind))
      fail(400, "This item cannot be self-completed.");
    if (d.complete)
      await run(
        db,
        "INSERT OR IGNORE INTO completions (id,user_id,batch_id,content_id,created) VALUES (?,?,?,?,?)",
        id(),
        u.id,
        d.batch_id,
        c.id,
        now(),
      );
    else
      await run(
        db,
        "DELETE FROM completions WHERE user_id=? AND batch_id=? AND content_id=?",
        u.id,
        d.batch_id,
        c.id,
      );
    return json({ ok: true });
  }
  if (p === "/api/submissions" && req.method === "POST") {
    const d = await req.json();
    const c = await visibleContent(db, u, d.content_id, d.batch_id);
    if (c.kind !== "lab") fail(400, "Select a lab.");
    await checkFile(db, u, d.file_id);
    const submissionBatch = await member(db, u, d.batch_id);
    if (d.file_id) {
      const f = await one(db, "SELECT name FROM files WHERE id=?", d.file_id);
      if (!/\.(pdf|docx)$/i.test(f.name))
        fail(400, "Lab submissions require PDF or DOCX.");
    }
    const submissionId = id();
    await run(
      db,
      "INSERT INTO submissions (id,content_id,user_id,batch_id,body,file_id,created) VALUES (?,?,?,?,?,?,?)",
      submissionId,
      c.id,
      u.id,
      d.batch_id,
      required(
        d.body || (d.file_id ? "Attached lab solution" : ""),
        "Your answer",
        20000,
      ),
      d.file_id || null,
      now(),
    );
    if (
      d.file_id &&
      JSON.parse(submissionBatch.config || "{}").submission_folder
    ) {
      const f = await one(db, "SELECT name FROM files WHERE id=?", d.file_id);
      if (!/\.(pdf|docx)$/i.test(f.name))
        fail(400, "Drive lab submissions require PDF or DOCX.");
      await queueJob(db, "drive_submission", d.batch_id, submissionId, {});
      await run(
        db,
        "UPDATE submissions SET drive_status='pending' WHERE id=?",
        submissionId,
      );
      if (env.AZURE_ENGINE_URL)
        try {
          await wakeEngine(env);
        } catch {}
    }
    return json({ ok: true });
  }
  if (p === "/api/tickets" && req.method === "POST") {
    const d = await req.json();
    if (d.ticket_id) {
      const t = await one(
        db,
        "SELECT * FROM tickets WHERE id=? AND user_id=?",
        d.ticket_id,
        u.id,
      );
      if (!t) fail(404, "Query not found.");
      await member(db, u, t.batch_id);
      const messageBody = required(d.body, "Message", 10000);
      let msgs = [];
      try {
        msgs = JSON.parse(t.messages || "[]");
      } catch {}
      if (!msgs.length && t.body) {
        msgs.push({
          id: id(),
          author_id: t.user_id,
          author_name: "Student",
          role: "student",
          body: t.body,
          created: t.created,
        });
      }
      msgs.push({
        id: id(),
        author_id: u.id,
        author_name: u.name,
        role: u.role,
        body: messageBody,
        created: now(),
      });
      await run(
        db,
        "UPDATE tickets SET messages=?,status='open' WHERE id=?",
        JSON.stringify(msgs),
        t.id,
      );
      return json({ ok: true, id: t.id });
    }
    await member(db, u, d.batch_id);
    const category = [
      "academic",
      "lab",
      "assessment",
      "fees",
      "technical",
    ].includes(d.category)
      ? d.category
      : "academic";
    const subject = required(d.subject, "Subject");
    const bodyText = required(d.body, "Message", 10000);
    const createdAt = now();
    const ticketId = id();
    const initialMessages = JSON.stringify([
      {
        id: id(),
        author_id: u.id,
        author_name: u.name,
        role: u.role,
        body: bodyText,
        created: createdAt,
      },
    ]);
    await run(
      db,
      "INSERT INTO tickets (id,user_id,batch_id,subject,body,category,messages,created) VALUES (?,?,?,?,?,?,?,?)",
      ticketId,
      u.id,
      d.batch_id,
      subject,
      bodyText,
      category,
      initialMessages,
      createdAt,
    );
    return json({ ok: true, id: ticketId });
  }
  if (p === "/api/tests/start" && req.method === "POST") {
    const d = await req.json();
    const b = await member(db, u, d.batch_id);
    const t = await one(
      db,
      "SELECT * FROM tests WHERE id=? AND course_id=? AND published=1 AND (batch_id IS NULL OR batch_id=?)",
      d.test_id,
      b.course_id,
      b.id,
    );
    if (!t) fail(404, "Test not found.");
    if (t.topic_order > b.covered)
      fail(403, "Your instructor has not yet released this topic.");
    const existing = await one(
      db,
      "SELECT * FROM attempts WHERE test_id=? AND user_id=? AND batch_id=? AND submitted IS NULL ORDER BY started DESC LIMIT 1",
      t.id,
      u.id,
      b.id,
    );
    let a = existing;
    if (!a) {
      const n = await one(
        db,
        "SELECT COUNT(*) n FROM attempts WHERE test_id=? AND user_id=? AND batch_id=?",
        t.id,
        u.id,
        b.id,
      );
      if (n.n >= 1) fail(400, "You have already attempted this assessment.");
      a = {
        id: id(),
        started: now(),
        snapshot: JSON.stringify({
          questions: normalizeQuestions(JSON.parse(t.questions)),
          duration: t.duration,
        }),
      };
      await run(
        db,
        "INSERT INTO attempts (id,test_id,user_id,batch_id,started,snapshot) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM attempts WHERE test_id=? AND user_id=? AND batch_id=?)<1 AND NOT EXISTS (SELECT 1 FROM attempts WHERE test_id=? AND user_id=? AND batch_id=? AND submitted IS NULL)",
        a.id,
        t.id,
        u.id,
        b.id,
        a.started,
        a.snapshot,
        t.id,
        u.id,
        b.id,
        t.id,
        u.id,
        b.id,
      );
      a = await one(
        db,
        "SELECT * FROM attempts WHERE test_id=? AND user_id=? AND batch_id=? AND submitted IS NULL ORDER BY started DESC LIMIT 1",
        t.id,
        u.id,
        b.id,
      );
      if (!a) fail(400, "You have already attempted this assessment.");
    }
    const snap = JSON.parse(a.snapshot);
    return json({
      id: a.id,
      title: t.title,
      questions: publicQuestions(snap.questions),
      answers: JSON.parse(a.answers || "[]"),
      expires_at: new Date(
        new Date(a.started).getTime() + snap.duration * 60000,
      ).toISOString(),
    });
  }
  if (p === "/api/tests/save" && req.method === "POST") {
    const d = await req.json(),
      a = await one(
        db,
        "SELECT * FROM attempts WHERE id=? AND user_id=? AND submitted IS NULL",
        d.attempt_id,
        u.id,
      );
    if (!a) fail(409, "This attempt is already submitted or unavailable.");
    await member(db, u, a.batch_id);
    const snap = JSON.parse(a.snapshot);
    if (Date.now() > Date.parse(a.started) + snap.duration * 60000)
      fail(409, "The test timer has expired.");
    if (
      !Array.isArray(d.answers) ||
      d.answers.length > snap.questions.length ||
      d.answers.some((v, i) => !validAnswer(snap.questions[i], v))
    )
      fail(400, "Invalid answers.");
    await run(
      db,
      "UPDATE attempts SET answers=? WHERE id=? AND submitted IS NULL",
      JSON.stringify(d.answers),
      a.id,
    );
    return json({ ok: true });
  }
  if (p === "/api/tests/submit" && req.method === "POST") {
    const d = await req.json();
    const a = await one(
      db,
      "SELECT * FROM attempts WHERE id=? AND user_id=?",
      d.attempt_id,
      u.id,
    );
    if (!a) fail(404, "Attempt not found.");
    const snap = JSON.parse(a.snapshot),
      qs = snap.questions;
    if (a.submitted)
      return json({
        id: a.id,
        grading_status: a.grading_status,
        feedback: JSON.parse(a.feedback || "[]"),
        summary: JSON.parse(a.summary || "{}"),
        score: a.score,
        total: a.total,
        questions: qs,
        answers: JSON.parse(a.answers),
      });
    if (
      !Array.isArray(d.answers) ||
      d.answers.length > qs.length ||
      d.answers.some((v, i) => !validAnswer(qs[i], v))
    )
      fail(400, "Invalid answers.");
    await member(db, u, a.batch_id);
    const expired =
      Date.now() >
      new Date(a.started).getTime() + snap.duration * 60000 + 10000;
    const answers = expired ? [] : d.answers,
      score =
        Math.round(
          qs.reduce(
            (sum, q, i) =>
              sum + (objectiveCorrect(q, answers[i]) ? q.marks : 0),
            0,
          ) * 100,
        ) / 100;
    const baselineFeedback = qs.map((q, i) => ({
      marks: objectiveCorrect(q, answers[i]) ? q.marks : 0,
      max_marks: q.marks,
      feedback:
        q.explanation ||
        (objectiveCorrect(q, answers[i]) ? "Correct answer." : "Review this topic."),
    }));
    const baselineSummary = sanitizeSummary({}, qs, baselineFeedback);
    const submissionWrite = await run(
      db,
      "UPDATE attempts SET submitted=?,answers=?,score=?,total=?,summary=? WHERE id=? AND submitted IS NULL",
      now(),
      JSON.stringify(answers),
      score,
      100,
      JSON.stringify(baselineSummary),
      a.id,
    );
    const assessment = await one(
      db,
      "SELECT ai_generated FROM tests WHERE id=?",
      a.test_id,
    );
    if (
      (assessment?.ai_generated || qs.some(written)) &&
      submissionWrite.meta?.changes
    ) {
      await queueJob(db, "evaluate_test", a.batch_id, a.id, {});
      await run(
        db,
        "UPDATE attempts SET grading_status='pending' WHERE id=?",
        a.id,
      );
      if (env.AZURE_ENGINE_URL)
        try {
          await wakeEngine(env);
        } catch {}
    }
    const saved = await one(
      db,
      "SELECT score,total,answers,grading_status,summary FROM attempts WHERE id=?",
      a.id,
    );
    return json({
      id: a.id,
      grading_status: saved.grading_status,
      score: saved.score,
      total: saved.total,
      summary: JSON.parse(saved.summary || "{}"),
      questions: qs,
      answers: JSON.parse(saved.answers),
      expired,
    });
  }
  if (p.startsWith("/api/results/") && req.method === "GET") {
    const a = await one(
      db,
      "SELECT * FROM attempts WHERE id=?",
      p.split("/").pop(),
    );
    if (!a || (!isStaff(u) && a.user_id !== u.id))
      fail(404, "Result not found.");
    if (!a.submitted) fail(400, "Test not submitted yet.");
    return json({
      id: a.id,
      feedback: JSON.parse(a.feedback || "[]"),
      summary: JSON.parse(a.summary || "{}"),
      grading_status: a.grading_status,
      score: a.score,
      total: a.total,
      questions: JSON.parse(a.snapshot).questions,
      answers: JSON.parse(a.answers),
    });
  }
  if (p === "/api/upload" && req.method === "POST") {
    if (!env.BUCKET) fail(503, "File storage unavailable.");
    const form = await req.formData(),
      file = form.get("file");
    if (
      !file ||
      typeof file === "string" ||
      file.size === 0 ||
      file.size > 20 * 1024 * 1024
    )
      fail(400, "Choose a file between 1 byte and 20 MB.");
    const allowed = [
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "svg",
      "txt",
      "md",
      "zip",
      "docx",
      "doc",
      "pptx",
      "ppt",
      "xlsx",
      "csv",
      "yaml",
      "yml",
      "sh",
      "py",
      "json",
    ];
    if (!allowed.includes(file.name.split(".").pop().toLowerCase()))
      fail(400, "Supported: PDF, images, text, YAML/scripts, ZIP, Office and CSV.");
    const fid = id();
    await env.BUCKET.put(fid, await file.arrayBuffer());
    try {
      await run(
        db,
        "INSERT INTO files (id,owner_id,name,mime,size,created) VALUES (?,?,?,?,?,?)",
        fid,
        u.id,
        file.name.slice(0, 200),
        file.type || "application/octet-stream",
        file.size,
        now(),
      );
    } catch (e) {
      await env.BUCKET.delete(fid);
      throw e;
    }
    return json({ id: fid, name: file.name });
  }
  if (p.startsWith("/api/files/") && req.method === "GET") {
    const fid = p.split("/").pop(),
      f = await one(db, "SELECT * FROM files WHERE id=?", fid);
    if (!f) fail(404, "File not found.");
    if (f.owner_id !== u.id && !isStaff(u)) {
      const candidates = await rows(
        db,
        "SELECT DISTINCT b.id FROM content c JOIN batches b ON b.course_id=c.course_id JOIN enrollments e ON e.batch_id=b.id WHERE c.file_id=? AND c.published=1 AND e.user_id=? AND (c.batch_id IS NULL OR c.batch_id=b.id)",
        fid,
        u.id,
      );
      let allowed = false;
      for (const b of candidates) {
        try {
          await member(db, u, b.id);
          allowed = true;
          break;
        } catch {}
      }
      if (!allowed) fail(403, "File access denied.");
    }
    const obj = await env.BUCKET.get(fid);
    if (!obj) fail(404, "File unavailable.");
    const isInline = new URL(req.url).searchParams.has("inline");
    let contentType = "application/octet-stream";
    let inlineAllowed = false;
    let csp =
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
    if (/\.pptx$/i.test(f.name)) {
      contentType =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else if (/\.ppt$/i.test(f.name)) {
      contentType = "application/vnd.ms-powerpoint";
    }
    if (isInline) {
      if (/\.pdf$/i.test(f.name)) {
        contentType = "application/pdf";
        inlineAllowed = true;
        csp = "default-src 'none'; frame-ancestors 'self'";
      } else if (/\.png$/i.test(f.name)) {
        contentType = "image/png";
        inlineAllowed = true;
        csp = "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'";
      } else if (/\.jpe?g$/i.test(f.name)) {
        contentType = "image/jpeg";
        inlineAllowed = true;
        csp = "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'";
      } else if (/\.webp$/i.test(f.name)) {
        contentType = "image/webp";
        inlineAllowed = true;
        csp = "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'";
      } else if (/\.gif$/i.test(f.name)) {
        contentType = "image/gif";
        inlineAllowed = true;
        csp = "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'";
      } else if (/\.svg$/i.test(f.name)) {
        contentType = "image/svg+xml";
        inlineAllowed = true;
        csp =
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
      } else if (/\.(txt|md|ya?ml|sh|py|json|csv)$/i.test(f.name)) {
        contentType = "text/plain; charset=utf-8";
        inlineAllowed = true;
      }
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${inlineAllowed ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (p.startsWith("/api/admin")) {
    staff(u);
    return adminApi(req, db, u, p);
  }
  fail(404, "Endpoint not found.");
}
async function checkFile(db, u, fid) {
  if (
    fid &&
    !(await one(
      db,
      "SELECT id FROM files WHERE id=? AND (owner_id=? OR ?=1)",
      fid,
      u.id,
      isStaff(u) ? 1 : 0,
    ))
  )
    fail(400, "Upload a valid file first.");
}
async function adminApi(req, db, u, p) {
  if (p === "/api/admin/data" && req.method === "GET") {
    const names = [
      "users",
      "courses",
      "batches",
      "invitations",
      "enrollments",
      "content",
      "tests",
      "submissions",
      "tickets",
      "payments",
      "attempts",
      "completions",
      "automation_sources",
      "access_groups",
      "group_members",
    ];
    const data = {};
    for (const n of names) {
      if (n === "payments" && u.role !== "admin") {
        data[n] = [];
        continue;
      }
      data[n] = await rows(
        db,
        `SELECT ${
          n === "attempts"
            ? "id,test_id,user_id,batch_id,started,submitted,score,total,grading_status,summary"
            : "*"
        } FROM ${n} LIMIT 5000`,
      );
    }
    data.audit = await rows(
      db,
      "SELECT * FROM audit ORDER BY created DESC LIMIT 100",
    );
    return json(data);
  }
  if (req.method !== "POST") fail(405, "Method not allowed.");
  const d = await req.json();
  const action = p.split("/").pop();
  if (action === "save") {
    const kind = d.entity,
      v = d.values || {},
      key = v.id || id();
    let fields;
    if (kind === "courses") {
      admin(u);
      let syllabus;
      try {
        syllabus = JSON.parse(v.syllabus);
        if (
          !Array.isArray(syllabus) ||
          !syllabus.length ||
          syllabus.length > 100 ||
          syllabus.some((s) => !s.title || !s.detail)
        )
          throw 0;
      } catch {
        fail(400, "Syllabus must be a JSON list of title and detail objects.");
      }
      if (!/^[A-Z]{3}$/.test((v.currency || "INR").toUpperCase()))
        fail(400, "Use a valid three-letter currency.");
      try {
        new Intl.NumberFormat("en", {
          style: "currency",
          currency: v.currency || "INR",
        }).format(0);
      } catch {
        fail(400, "Invalid currency.");
      }
      fields = {
        title: required(v.title, "Title"),
        description: required(v.description, "Description", 5000),
        syllabus: JSON.stringify(syllabus),
        fee: integer(v.fee, "fee"),
        currency: required(v.currency || "INR", "Currency", 3).toUpperCase(),
      };
    } else if (kind === "batches") {
      if (!(await one(db, "SELECT id FROM courses WHERE id=?", v.course_id)))
        fail(400, "Choose a course.");
      try {
        Intl.DateTimeFormat("en", { timeZone: v.timezone }).format();
      } catch {
        fail(400, "Use a valid timezone, such as Asia/Kolkata.");
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v.start_date) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v.end_date) ||
        v.end_date < v.start_date
      )
        fail(400, "Choose valid batch dates.");
      fields = {
        course_id: v.course_id,
        name: required(v.name, "Name"),
        start_date: v.start_date,
        end_date: v.end_date,
        timezone: v.timezone,
        covered: integer(v.covered, "covered topics", 0, 100),
        status: ["active", "upcoming", "archived"].includes(v.status)
          ? v.status
          : "active",
      };
    } else if (kind === "invitations") {
      const email = required(v.email, "Email").toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail(400, "Enter a valid email.");
      await member(db, u, v.batch_id);
      const targetRole = ["admin", "trainer", "student"].includes(v.role)
        ? v.role
        : "student";
      if (targetRole !== "student") admin(u);
      fields = {
        email,
        batch_id: v.batch_id,
        role: targetRole,
        fee: integer(v.fee, "fee"),
      };
      const exists = await one(
        db,
        "SELECT id FROM invitations WHERE email=? AND batch_id=?",
        email,
        v.batch_id,
      );
      if (exists && !v.id)
        fail(400, "This student is already invited to the batch.");
    } else if (kind === "content") {
      const kinds = [
        "live",
        "recording",
        "notes",
        "lab",
        "slides",
        "guide",
        "image",
        "sop",
        "test_link",
      ];
      if (!kinds.includes(v.kind)) fail(400, "Invalid resource type.");
      if (!(await one(db, "SELECT id FROM courses WHERE id=?", v.course_id)))
        fail(400, "Choose a course.");
      if (v.batch_id) {
        const b = await member(db, u, v.batch_id);
        if (b.course_id !== v.course_id)
          fail(400, "Batch and course must match.");
      }
      const old = await one(db, "SELECT * FROM content WHERE id=?", key);
      if (
        old &&
        (old.course_id !== v.course_id ||
          (old.batch_id || "") !== (v.batch_id || ""))
      )
        fail(400, "Create a new resource to change its course or batch.");
      if (v.file_id !== old?.file_id) await checkFile(db, u, v.file_id);
      if (v.starts_at && isNaN(Date.parse(v.starts_at)))
        fail(400, "Choose a valid session date.");
      fields = {
        course_id: v.course_id,
        batch_id: v.batch_id || null,
        kind: v.kind,
        title: required(v.title, "Title"),
        topic: required(v.topic, "Topic"),
        topic_order: integer(v.topic_order, "topic number", 1, 100),
        body: String(v.body || "").slice(0, 30000),
        url: url(v.url),
        starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : "",
        duration: integer(v.duration || 60, "duration", 1, 1440),
        file_id: v.file_id || null,
        published: Number(v.published) ? 1 : 0,
        created: old?.created || now(),
      };
    } else if (kind === "tests") {
      let qs;
      try {
        qs = JSON.parse(v.questions);
        if (
          !Array.isArray(qs) ||
          !qs.length ||
          qs.length > 100 ||
          qs.some((q) => !validQuestion(q))
        )
          throw 0;
        qs = normalizeQuestions(qs);
      } catch {
        fail(
          400,
          "Each question needs a supported type, valid answer key and a grading rubric for written answers.",
        );
      }
      if (!["daily", "weekly", "monthly"].includes(v.kind))
        fail(400, "Choose a test type.");
      if (!(await one(db, "SELECT id FROM courses WHERE id=?", v.course_id)))
        fail(400, "Choose a course.");
      const old = await one(db, "SELECT * FROM tests WHERE id=?", key);
      fields = {
        course_id: v.course_id,
        title: required(v.title, "Title"),
        kind: v.kind,
        topic_order: integer(v.topic_order, "topic", 1, 100),
        duration: integer(v.duration, "duration", 1, 180),
        batch_id:
          v.batch_id !== undefined
            ? v.batch_id || null
            : old?.batch_id || null,
        source_ids:
          v.source_ids !== undefined
            ? typeof v.source_ids === "string"
              ? v.source_ids
              : JSON.stringify(v.source_ids)
            : old?.source_ids || "[]",
        ai_generated:
          v.ai_generated !== undefined
            ? Number(v.ai_generated)
              ? 1
              : 0
            : old?.ai_generated || 0,
        questions: JSON.stringify(qs),
        published: Number(v.published) ? 1 : 0,
      };
    } else fail(400, "Unknown entity.");
    const keys = Object.keys(fields),
      vals = Object.values(fields);
    await run(
      db,
      `INSERT INTO ${kind} (id,${keys.join(",")}) VALUES (?,${keys.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys.map((k) => `${k}=excluded.${k}`).join(",")}`,
      key,
      ...vals,
    );
    if (kind === "invitations") {
      const existingUser = await one(
        db,
        "SELECT id,role FROM users WHERE email=?",
        fields.email,
      );
      if (existingUser) {
        const existingEnrollment = await one(
          db,
          "SELECT id FROM enrollments WHERE user_id=? AND batch_id=?",
          existingUser.id,
          fields.batch_id,
        );
        if (existingEnrollment) {
          if (v.id) {
            await run(
              db,
              "UPDATE enrollments SET fee=? WHERE id=?",
              fields.fee,
              existingEnrollment.id,
            );
          }
        } else {
          await run(
            db,
            "INSERT OR IGNORE INTO enrollments (id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
            id(),
            existingUser.id,
            fields.batch_id,
            fields.fee,
            now(),
          );
        }
        if (fields.role === "admin")
          await run(
            db,
            "UPDATE users SET role='admin' WHERE id=?",
            existingUser.id,
          );
        else if (fields.role === "trainer" && existingUser.role !== "admin")
          await run(
            db,
            "UPDATE users SET role='trainer' WHERE id=?",
            existingUser.id,
          );
      }
    }
    if (
      kind === "batches" &&
      typeof v.drive_folder === "string" &&
      v.drive_folder.trim()
    )
      await saveSource(
        db,
        key,
        v.drive_folder,
        true,
        v.drive_config !== undefined ? v.drive_config : null,
      );
    await log(db, u, `save:${kind}`, key);
    return json({ id: key });
  }
  if (action === "delete") {
    const kind = d.entity,
      targetId = required(d.id, "ID");
    if (kind === "courses") {
      admin(u);
      if (
        await one(db, "SELECT id FROM batches WHERE course_id=?", targetId)
      )
        fail(400, "Delete or archive batches in this course before deleting it.");
      await run(db, "DELETE FROM content WHERE course_id=?", targetId);
      await run(db, "DELETE FROM tests WHERE course_id=?", targetId);
      await run(db, "DELETE FROM courses WHERE id=?", targetId);
    } else if (kind === "batches") {
      if (
        await one(db, "SELECT id FROM enrollments WHERE batch_id=?", targetId)
      )
        fail(400, "Remove student enrollments before deleting this batch.");
      const sources = await rows(
        db,
        "SELECT id FROM automation_sources WHERE batch_id=?",
        targetId,
      );
      for (const s of sources) {
        await run(db, "DELETE FROM import_items WHERE source_id=?", s.id);
        await run(db, "DELETE FROM import_runs WHERE source_id=?", s.id);
      }
      await run(db, "DELETE FROM automation_sources WHERE batch_id=?", targetId);
      const groups = await rows(
        db,
        "SELECT id FROM access_groups WHERE batch_id=?",
        targetId,
      );
      for (const g of groups) {
        await run(db, "DELETE FROM group_members WHERE group_id=?", g.id);
      }
      await run(db, "DELETE FROM access_groups WHERE batch_id=?", targetId);
      await run(db, "DELETE FROM invitations WHERE batch_id=?", targetId);
      await run(db, "DELETE FROM content WHERE batch_id=?", targetId);
      await run(db, "DELETE FROM tests WHERE batch_id=?", targetId);
      await run(db, "DELETE FROM batches WHERE id=?", targetId);
    } else if (kind === "invitations") {
      await run(db, "DELETE FROM invitations WHERE id=?", targetId);
    } else if (kind === "enrollments") {
      if (
        await one(
          db,
          "SELECT id FROM payments WHERE enrollment_id=?",
          targetId,
        )
      )
        fail(400, "Void recorded fee payments before removing this enrollment.");
      await run(db, "DELETE FROM enrollments WHERE id=?", targetId);
    } else if (kind === "payments") {
      admin(u);
      await run(db, "DELETE FROM payments WHERE id=?", targetId);
    } else if (kind === "content") {
      await run(db, "DELETE FROM completions WHERE content_id=?", targetId);
      await run(db, "DELETE FROM submissions WHERE content_id=?", targetId);
      await run(
        db,
        "UPDATE import_items SET content_id=NULL WHERE content_id=?",
        targetId,
      );
      await run(db, "DELETE FROM content WHERE id=?", targetId);
    } else if (kind === "tests") {
      await run(db, "DELETE FROM attempts WHERE test_id=?", targetId);
      await run(db, "DELETE FROM tests WHERE id=?", targetId);
    } else {
      fail(400, "Unsupported delete entity.");
    }
    await log(db, u, `delete:${kind}`, targetId);
    return json({ ok: true });
  }
  if (action === "attempt-action") {
    const a = await one(
      db,
      "SELECT * FROM attempts WHERE id=?",
      required(d.attempt_id, "Attempt ID"),
    );
    if (!a) fail(404, "Attempt not found.");
    if (d.mode === "reset") {
      await run(
        db,
        "DELETE FROM engine_jobs WHERE kind='evaluate_test' AND entity_id=?",
        a.id,
      );
      await run(db, "DELETE FROM attempts WHERE id=?", a.id);
      await log(db, u, "retake:attempt", a.id);
      return json({ ok: true });
    }
    if (d.mode === "grade") {
      const newScore = Number(d.score);
      if (!Number.isFinite(newScore) || newScore < 0 || newScore > 100)
        fail(400, "Score must be between 0 and 100.");
      const updatedFeedback =
        d.feedback !== undefined
          ? typeof d.feedback === "string"
            ? d.feedback
            : JSON.stringify(d.feedback)
          : a.feedback || "[]";
      const updatedSummary =
        d.summary !== undefined
          ? typeof d.summary === "string"
            ? d.summary
            : JSON.stringify(d.summary)
          : a.summary || "{}";
      await run(
        db,
        "UPDATE attempts SET score=?,feedback=?,summary=?,grading_status='complete' WHERE id=?",
        Math.round(newScore * 100) / 100,
        updatedFeedback,
        updatedSummary,
        a.id,
      );
      await log(db, u, "grade:attempt", a.id);
      return json({ ok: true });
    }
    fail(400, "Choose reset or grade.");
  }
  if (action === "bulk-invite") {
    const batchId = required(d.batch_id, "Batch");
    await member(db, u, batchId);
    const defaultFee = integer(d.fee || 0, "fee");
    let entries = [];
    if (Array.isArray(d.entries)) {
      entries = d.entries;
    } else if (typeof d.csv === "string" && d.csv.trim()) {
      for (const rawLine of d.csv.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^email(\s*,|$)/i.test(line)) continue;
        const parts = line.split(",").map((s) => s.trim());
        entries.push({
          email: parts[0],
          name: parts[1] || "",
          fee: parts[2] !== undefined && parts[2] !== "" ? Number(parts[2]) : defaultFee,
        });
      }
    }
    if (!entries.length || entries.length > 500)
      fail(400, "Provide between 1 and 500 student entries.");
    let invited = 0,
      enrolled = 0;
    for (const entry of entries) {
      const email = String(entry.email || "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail(400, `Invalid email address: ${email || "empty"}`);
      const fee = Number.isSafeInteger(Number(entry.fee))
        ? Math.max(0, Number(entry.fee))
        : defaultFee;
      await run(
        db,
        "INSERT INTO invitations (id,email,batch_id,role,fee) VALUES (?,?,?,'student',?) ON CONFLICT(email,batch_id) DO UPDATE SET fee=excluded.fee",
        id(),
        email,
        batchId,
        fee,
      );
      invited++;
      const existingUser = await one(
        db,
        "SELECT id FROM users WHERE email=?",
        email,
      );
      if (existingUser) {
        const res = await run(
          db,
          "INSERT OR IGNORE INTO enrollments (id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
          id(),
          existingUser.id,
          batchId,
          fee,
          now(),
        );
        if (res.meta?.changes) enrolled++;
      }
    }
    await log(db, u, "bulk_invite:invitations", batchId);
    return json({ ok: true, invited, enrolled });
  }
  if (action === "complete-session") {
    const session = await one(
      db,
      "SELECT * FROM content WHERE id=? AND kind='live'",
      required(d.session_id, "Session ID"),
    );
    if (!session) fail(404, "Live session not found.");
    await run(
      db,
      "UPDATE content SET session_status='completed' WHERE id=?",
      session.id,
    );
    let recordingId = null;
    if (d.recording_url && String(d.recording_url).trim()) {
      const recUrl = url(d.recording_url);
      recordingId = id();
      await run(
        db,
        "INSERT INTO content (id,course_id,batch_id,kind,title,topic,topic_order,body,url,starts_at,duration,published,created) VALUES (?,?,?,'recording',?,?,?,?,?,?,?,1,?)",
        recordingId,
        session.course_id,
        session.batch_id,
        `${session.title} — Recording`,
        session.topic,
        session.topic_order,
        String(d.notes || session.body || "").slice(0, 10000),
        recUrl,
        session.starts_at || "",
        session.duration || 60,
        now(),
      );
    }
    if (d.advance_covered !== false && session.batch_id) {
      await run(
        db,
        "UPDATE batches SET covered=CASE WHEN covered<? THEN ? ELSE covered END WHERE id=?",
        session.topic_order,
        session.topic_order,
        session.batch_id,
      );
    }
    await log(db, u, "complete:session", session.id);
    return json({ ok: true, recording_id: recordingId });
  }
  if (action === "payment") {
    admin(u);
    const enrollment = await one(
      db,
      "SELECT * FROM enrollments WHERE id=?",
      d.enrollment_id,
    );
    if (!enrollment) fail(400, "Choose an enrollment.");
    const amount = integer(d.amount, "amount", 1);
    const paid = await one(
      db,
      "SELECT COALESCE(SUM(amount),0) total FROM payments WHERE enrollment_id=?",
      enrollment.id,
    );
    if (amount + paid.total > enrollment.fee)
      fail(400, "Payment exceeds outstanding fees.");
    const ref = required(d.reference, "Payment reference");
    if (await one(db, "SELECT id FROM payments WHERE reference=?", ref))
      fail(400, "This payment reference is already recorded.");
    if (!d.paid_at || isNaN(Date.parse(d.paid_at)))
      fail(400, "Choose a payment date.");
    const recorded = await run(
      db,
      "INSERT INTO payments (id,enrollment_id,amount,reference,paid_at) SELECT ?,?,?,?,? WHERE ? <= (SELECT fee-COALESCE((SELECT SUM(amount) FROM payments WHERE enrollment_id=?),0) FROM enrollments WHERE id=?)",
      id(),
      enrollment.id,
      amount,
      ref,
      d.paid_at,
      amount,
      enrollment.id,
      enrollment.id,
    );
    if (recorded.meta?.changes === 0)
      fail(400, "Payment exceeds outstanding fees.");
    await log(db, u, "record:payment", enrollment.id);
    return json({ ok: true });
  }
  if (action === "review") {
    const s = await one(db, "SELECT * FROM submissions WHERE id=?", d.id);
    if (!s) fail(404, "Submission not found.");
    if (!["accepted", "revision_requested", "submitted"].includes(d.status))
      fail(400, "Invalid status.");
    await run(
      db,
      "UPDATE submissions SET status=?,feedback=? WHERE id=?",
      d.status,
      String(d.feedback || "").slice(0, 10000),
      d.id,
    );
    if (d.status === "accepted")
      await run(
        db,
        "INSERT OR IGNORE INTO completions (id,user_id,batch_id,content_id,created) VALUES (?,?,?,?,?)",
        id(),
        s.user_id,
        s.batch_id,
        s.content_id,
        now(),
      );
    else {
      const accepted = await one(
        db,
        "SELECT id FROM submissions WHERE user_id=? AND batch_id=? AND content_id=? AND status='accepted'",
        s.user_id,
        s.batch_id,
        s.content_id,
      );
      if (!accepted)
        await run(
          db,
          "DELETE FROM completions WHERE user_id=? AND batch_id=? AND content_id=?",
          s.user_id,
          s.batch_id,
          s.content_id,
        );
    }
    await log(db, u, "review:submission", d.id);
    return json({ ok: true });
  }
  if (action === "reply") {
    if (!["open", "resolved"].includes(d.status)) fail(400, "Invalid status.");
    const t = await one(db, "SELECT * FROM tickets WHERE id=?", d.id);
    if (!t) fail(404, "Query not found.");
    const replyText = required(d.reply, "Reply", 10000);
    let msgs = [];
    try {
      msgs = JSON.parse(t.messages || "[]");
    } catch {}
    if (!msgs.length && t.body) {
      msgs.push({
        id: id(),
        author_id: t.user_id,
        author_name: "Student",
        role: "student",
        body: t.body,
        created: t.created,
      });
    }
    msgs.push({
      id: id(),
      author_id: u.id,
      author_name: u.name,
      role: u.role,
      body: replyText,
      created: now(),
    });
    await run(
      db,
      "UPDATE tickets SET reply=?,messages=?,status=? WHERE id=?",
      replyText,
      JSON.stringify(msgs),
      d.status,
      d.id,
    );
    await log(db, u, "reply:ticket", d.id);
    return json({ ok: true });
  }
  if (action === "role") {
    admin(u);
    const owner = await one(db, "SELECT value FROM settings WHERE key='owner'");
    if (d.id === owner?.value) fail(400, "The owner role cannot be changed.");
    if (!["admin", "trainer", "student"].includes(d.role))
      fail(400, "Invalid role.");
    await run(db, "UPDATE users SET role=? WHERE id=?", d.role, d.id);
    await run(
      db,
      "UPDATE invitations SET role=? WHERE email=(SELECT email FROM users WHERE id=?)",
      d.role,
      d.id,
    );
    await log(db, u, "change:role", d.id);
    return json({ ok: true });
  }
  fail(404, "Admin operation not found.");
}
