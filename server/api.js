import { learningRoutes, planAssessments } from "./learning.js";
import {
  validQuestion,
  normalizeQuestions,
  publicQuestion,
  validAnswer,
  written,
  objectiveCorrect,
} from "../shared/assessment.js";
import { member } from "./common.js";
import { authRoutes, sessionUser } from "./auth.js";
import { featureRoutes, queueJob, wakeEngine } from "./features.js";
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
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
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
const admin = (u) => {
  if (u.role !== "admin") fail(403, "Administrator access required.");
};
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
    (!c.published && u.role !== "admin")
  )
    fail(404, "Resource not found.");
  return c;
}
async function identity(req, db, env) {
  if (!["sites", "google", "entra"].includes(env.AUTH_MODE || "sites"))
    fail(503, "Authentication mode is not supported by this deployment.");
  const signedIn = await sessionUser(req, env);
  if (signedIn) return signedIn;
  if (["google", "entra"].includes(env.AUTH_MODE))
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
  let u = await one(db, "SELECT * FROM users WHERE id=?", uid);
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
      uid,
      invite.batch_id,
      invite.fee,
      now(),
    );
    if (invite.role === "admin")
      await run(db, "UPDATE users SET role='admin' WHERE id=?", uid);
  }
  u = await one(db, "SELECT * FROM users WHERE id=?", uid);
  if (!u.active) fail(403, "Your account is disabled.");
  return u;
}
export async function api(req, env) {
  try {
    return await handle(req, env);
  } catch (e) {
    if (e instanceof SyntaxError)
      e = new HttpError(400, "Invalid request data.");
    if (!e.status) console.error(e);
    return json(
      {
        error: e.status
          ? e.message
          : "The request could not be completed. Please try again.",
      },
      e.status || 500,
    );
  }
}
async function handle(req, env) {
  const p = new URL(req.url).pathname,
    db = env.DB;
  if (!db) fail(503, "Database is not configured.");
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("Origin");
    if (origin && origin !== new URL(req.url).origin)
      fail(403, "Invalid request origin.");
  }
  if (p.startsWith("/api/automation/")) return serviceAutomation(req, env);
  if (p.startsWith("/api/auth/")) {
    const response = await authRoutes(req, env);
    if (response) return response;
    fail(404, "Authentication endpoint not found.");
  }
  const u = await identity(req, db, env);
  const learning = await learningRoutes(req, env, u);
  if (learning) return learning;
  const enhanced = await featureRoutes(req, env, u);
  if (enhanced) return enhanced;
  if (p.startsWith("/api/admin/automation/"))
    return adminAutomation(req, env, u);
  if (p === "/api/bootstrap" && req.method === "GET") {
    if (
      u.role === "admin" &&
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
    let batches =
      u.role === "admin"
        ? await rows(db, "SELECT * FROM batches ORDER BY start_date DESC")
        : await rows(
            db,
            "SELECT b.* FROM batches b JOIN enrollments e ON e.batch_id=b.id WHERE e.user_id=? ORDER BY b.start_date DESC",
            u.id,
          );
    const courses =
      u.role === "admin"
        ? await rows(db, "SELECT * FROM courses")
        : await rows(
            db,
            "SELECT DISTINCT c.* FROM courses c JOIN batches b ON b.course_id=c.id JOIN enrollments e ON e.batch_id=b.id WHERE e.user_id=?",
            u.id,
          );
    if (u.role !== "admin") {
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
      "SELECT * FROM content WHERE course_id=? AND (batch_id IS NULL OR batch_id=?) AND published=1 ORDER BY topic_order,created",
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
        "SELECT id,test_id,started,submitted,score,total,grading_status FROM attempts WHERE user_id=? AND batch_id=? ORDER BY started DESC",
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
    if (!["notes", "slides", "recording", "guide"].includes(c.kind))
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
      (JSON.parse(submissionBatch.config || "{}").submission_folder ||
        (await one(
          db,
          "SELECT folder_id FROM automation_sources WHERE batch_id=? AND enabled=1",
          d.batch_id,
        )))
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
    await member(db, u, d.batch_id);
    await run(
      db,
      "INSERT INTO tickets (id,user_id,batch_id,subject,body,created) VALUES (?,?,?,?,?,?)",
      id(),
      u.id,
      d.batch_id,
      required(d.subject, "Subject"),
      required(d.body, "Message", 10000),
      now(),
    );
    return json({ ok: true });
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
    const submissionWrite = await run(
      db,
      "UPDATE attempts SET submitted=?,answers=?,score=?,total=? WHERE id=? AND submitted IS NULL",
      now(),
      JSON.stringify(answers),
      score,
      100,
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
      "SELECT score,total,answers,grading_status FROM attempts WHERE id=?",
      a.id,
    );
    return json({
      id: a.id,
      grading_status: saved.grading_status,
      score: saved.score,
      total: saved.total,
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
    if (!a || (u.role !== "admin" && a.user_id !== u.id))
      fail(404, "Result not found.");
    if (!a.submitted) fail(400, "Test not submitted yet.");
    return json({
      id: a.id,
      feedback: JSON.parse(a.feedback || "[]"),
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
      "txt",
      "md",
      "zip",
      "docx",
      "pptx",
      "xlsx",
      "csv",
    ];
    if (!allowed.includes(file.name.split(".").pop().toLowerCase()))
      fail(400, "Supported: PDF, images, text, ZIP, Office and CSV.");
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
    if (f.owner_id !== u.id && u.role !== "admin") {
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
    return new Response(obj.body, {
      headers: {
        "Content-Type":
          new URL(req.url).searchParams.has("inline") && /\.pdf$/i.test(f.name)
            ? "application/pdf"
            : "application/octet-stream",
        "Content-Disposition": `${new URL(req.url).searchParams.has("inline") && /\.pdf$/i.test(f.name) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (p.startsWith("/api/admin")) {
    admin(u);
    return adminApi(req, db, u, p, env);
  }
  fail(404, "Endpoint not found.");
}
async function checkFile(db, u, fid) {
  if (
    fid &&
    !(await one(
      db,
      "SELECT id FROM files WHERE id=? AND owner_id=?",
      fid,
      u.id,
    ))
  )
    fail(400, "Upload a valid file first.");
}
async function adminApi(req, db, u, p, env) {
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
    ];
    const data = {};
    for (const n of names)
      data[n] = await rows(
        db,
        `SELECT ${n === "attempts" ? "id,test_id,user_id,batch_id,started,submitted,score,total" : "*"} FROM ${n} LIMIT 5000`,
      );
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
      if (v.sop_file_id) {
        await checkFile(db, u, v.sop_file_id);
        const file = await one(
          db,
          "SELECT name FROM files WHERE id=?",
          v.sop_file_id,
        );
        if (!/\.(pdf|docx)$/i.test(file.name))
          fail(400, "Course SOP must be PDF or DOCX.");
      }
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
      const old = await one(
        db,
        "SELECT course_id FROM batches WHERE id=?",
        key,
      );
      if (old && old.course_id !== v.course_id)
        fail(400, "Create a new batch to change the course.");
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
      fields = {
        email,
        batch_id: v.batch_id,
        role: v.role === "admin" ? "admin" : "student",
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
        "sop",
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
      if (!["daily", "weekly", "monthly", "topic"].includes(v.kind))
        fail(400, "Choose a test type.");
      if (!(await one(db, "SELECT id FROM courses WHERE id=?", v.course_id)))
        fail(400, "Choose a course.");
      fields = {
        course_id: v.course_id,
        title: required(v.title, "Title"),
        kind: v.kind,
        topic_order: integer(v.topic_order, "topic", 1, 100),
        duration: integer(v.duration, "duration", 1, 180),
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
    if (
      kind === "batches" &&
      typeof v.drive_folder === "string" &&
      v.drive_folder.trim()
    )
      await saveSource(db, key, v.drive_folder, true);
    if (kind === "invitations") {
      const person = await one(
        db,
        "SELECT id FROM users WHERE email=?",
        fields.email,
      );
      if (person)
        await run(
          db,
          "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
          id(),
          person.id,
          fields.batch_id,
          fields.fee,
          now(),
        );
    }
    if (kind === "courses" && v.sop_file_id) {
      await checkFile(db, u, v.sop_file_id);
      const fid = await one(
        db,
        "SELECT name FROM files WHERE id=?",
        v.sop_file_id,
      );
      if (!/\.(pdf|docx)$/i.test(fid.name))
        fail(400, "Course SOP must be PDF or DOCX.");
      const sop = await one(
        db,
        "SELECT id FROM content WHERE course_id=? AND batch_id IS NULL AND kind='sop'",
        key,
      );
      await run(
        db,
        "INSERT INTO content(id,course_id,kind,title,topic,topic_order,body,file_id,published,created) VALUES (?,?,'sop',?,'Course SOP',1,'',?,1,?) ON CONFLICT(id) DO UPDATE SET file_id=excluded.file_id,title=excluded.title",
        sop?.id || id(),
        key,
        fields.title + " · SOP",
        v.sop_file_id,
        now(),
      );
    }
    if (kind === "content" && fields.published && fields.batch_id) {
      await planAssessments(env, fields.batch_id);
      try {
        await wakeEngine(env);
      } catch {}
    }
    await log(db, u, `save:${kind}`, key);
    return json({ id: key });
  }
  if (action === "payment") {
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
    if (!(await one(db, "SELECT id FROM tickets WHERE id=?", d.id)))
      fail(404, "Query not found.");
    await run(
      db,
      "UPDATE tickets SET reply=?,status=? WHERE id=?",
      required(d.reply, "Reply", 10000),
      d.status,
      d.id,
    );
    await log(db, u, "reply:ticket", d.id);
    return json({ ok: true });
  }
  if (action === "role") {
    const owner = await one(db, "SELECT value FROM settings WHERE key='owner'");
    if (d.id === owner.value) fail(400, "The owner role cannot be changed.");
    if (!["admin", "student"].includes(d.role)) fail(400, "Invalid role.");
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
