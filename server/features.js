import {
  QUESTION_TYPES,
  validQuestion,
  normalizeQuestions,
  written,
  objectiveCorrect,
  answerText,
  feedbackText,
} from "../shared/assessment.js";
import {
  one,
  rows,
  run,
  uid,
  now,
  fail,
  json,
  member,
  admin,
  https,
} from "./common.js";
import { setAdminPassword } from "./auth.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function wakeEngine(env, source_id = null) {
  if (!env.AZURE_ENGINE_URL || !env.AZURE_ENGINE_KEY) return false;
  const u = new URL(env.AZURE_ENGINE_URL);
  if (u.protocol !== "https:" || !u.hostname.endsWith(".azurewebsites.net"))
    fail(503, "Invalid Azure engine configuration.");
  try {
    const r = await fetch(u, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-functions-key": env.AZURE_ENGINE_KEY,
      },
      body: JSON.stringify({ source_id }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok)
      fail(
        503,
        "Azure did not accept the request. Try again or check the engine.",
      );
    return true;
  } catch {
    fail(
      503,
      "Azure engine could not be reached. The saved job can be retried.",
    );
  }
}
export async function queueJob(db, kind, batch, entity, payload) {
  const existing = await one(
    db,
    "SELECT id FROM engine_jobs WHERE kind=? AND entity_id=? AND status IN ('pending','running')",
    kind,
    entity,
  );
  if (existing) return existing.id;
  const id = uid();
  await run(
    db,
    "INSERT INTO engine_jobs(id,kind,batch_id,entity_id,payload,created) VALUES (?,?,?,?,?,?)",
    id,
    kind,
    batch,
    entity,
    JSON.stringify(payload),
    now(),
  );
  return id;
}
function safeConfig(d) {
  const email = String(d.support_email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, "Invalid support email.");
  const whatsapp = https(d.whatsapp_url);
  if (
    whatsapp &&
    !["chat.whatsapp.com", "wa.me", "api.whatsapp.com"].includes(
      new URL(whatsapp).hostname,
    )
  )
    fail(400, "Use an official WhatsApp link.");
  const roadmap = d.roadmap || [];
  if (
    !Array.isArray(roadmap) ||
    roadmap.length > 100 ||
    roadmap.some((r) => !r.title || !r.detail)
  )
    fail(400, "Each roadmap item needs a title and description.");
  const folder = d.submission_folder || "";
  if (folder && !/^[\w-]{10,200}$/.test(folder))
    fail(400, "Enter the destination Drive folder ID.");
  return {
    support_email: email,
    whatsapp_url: whatsapp,
    overview: String(d.overview || "").slice(0, 30000),
    roadmap,
    submission_folder: folder,
    pass_mark: Math.min(100, Math.max(1, Number(d.pass_mark) || 70)),
    sop_content_id: d.sop_content_id || "",
    require_google_group: !!d.require_google_group,
    assessment_automation: (() => {
      const v = d.assessment_automation || {};
      if (
        v.required_kinds &&
        (!Array.isArray(v.required_kinds) ||
          v.required_kinds.some(
            (k) =>
              !["recording", "notes", "slides", "guide", "lab"].includes(k),
          ))
      )
        fail(400, "Invalid required resource types.");
      if (
        v.lesson_topics &&
        (typeof v.lesson_topics !== "object" ||
          Object.keys(v.lesson_topics).some((k) => !/^\d{1,3}$/.test(k)))
      )
        fail(400, "Lesson mapping needs class numbers.");
      return {
        enabled: v.enabled !== false,
        auto_publish: v.auto_publish !== false,
        week_size: Math.max(1, Math.min(30, Number(v.week_size) || 7)),
        question_count: Math.max(
          11,
          Math.min(100, Number(v.question_count) || 12),
        ),
        required_kinds: v.required_kinds || [
          "recording",
          "notes",
          "slides",
          "lab",
        ],
        lesson_topics: v.lesson_topics || {},
        completed_topics: Array.isArray(v.completed_topics)
          ? v.completed_topics.map(String).slice(0, 100)
          : [],
      };
    })(),
  };
}
export async function featureRoutes(req, env, u) {
  const db = env.DB,
    p = new URL(req.url).pathname;
  if (p === "/api/admin/features" && req.method === "GET") {
    admin(u);
    return json({
      groups: await rows(db, "SELECT * FROM access_groups"),
      members: await rows(db, "SELECT * FROM group_members"),
      jobs: await rows(
        db,
        "SELECT id,kind,batch_id,entity_id,status,error,created,finished FROM engine_jobs ORDER BY created DESC LIMIT 100",
      ),
      engine_ready: !!(env.AZURE_ENGINE_URL && env.AZURE_ENGINE_KEY),
      google_ready: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      auth_mode: env.AUTH_MODE || "sites",
    });
  }
  if (p === "/api/admin/password" && req.method === "POST")
    return setAdminPassword(db, u, await req.json());
  if (p === "/api/admin/batch-config" && req.method === "POST") {
    admin(u);
    const d = await req.json();
    const previous = await member(db, u, d.batch_id);
    await run(
      db,
      "UPDATE batches SET config=? WHERE id=?",
      JSON.stringify(
        safeConfig({ ...JSON.parse(previous.config || "{}"), ...d }),
      ),
      d.batch_id,
    );
    await (await import("./learning.js")).planAssessments(env, d.batch_id);
    try {
      await wakeEngine(env);
    } catch {}
    return json({ ok: true });
  }
  if (p === "/api/admin/access" && req.method === "POST") {
    admin(u);
    const d = await req.json();
    const owner = await one(db, "SELECT value FROM settings WHERE key='owner'");
    if (d.user_id === u.id || d.user_id === owner?.value)
      fail(400, "You cannot disable yourself or the campus owner.");
    await run(
      db,
      "UPDATE users SET active=? WHERE id=?",
      d.active ? 1 : 0,
      d.user_id,
    );
    if (!d.active)
      await run(db, "DELETE FROM auth_sessions WHERE user_id=?", d.user_id);
    return json({ ok: true });
  }
  if (p === "/api/admin/group" && req.method === "POST") {
    admin(u);
    const d = await req.json();
    await member(db, u, d.batch_id);
    if (!d.name?.trim()) fail(400, "Group name is required.");
    const group = d.id || uid();
    const emails = [
      ...new Set(
        String(d.members || "")
          .split(/[\s,;]+/)
          .map((e) => e.toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (
      emails.length > 2000 ||
      emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    )
      fail(400, "Enter valid member email addresses.");
    const old = await one(db, "SELECT * FROM access_groups WHERE id=?", group);
    if (old && old.batch_id !== d.batch_id)
      fail(400, "Create a new group to change its batch.");
    const remote = String(d.google_group || "")
      .trim()
      .toLowerCase();
    if (remote && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(remote))
      fail(400, "Enter the Google Group email.");
    const previous = old
      ? await rows(
          db,
          "SELECT email FROM group_members WHERE group_id=?",
          group,
        )
      : [];
    if (remote) {
      if (
        await one(
          db,
          "SELECT id FROM engine_jobs WHERE kind='google_group_update' AND entity_id=? AND status IN ('pending','running')",
          group,
        )
      )
        fail(
          409,
          "A group update is already queued. Wait for it to finish before saving another change.",
        );
      if (old && old.google_group !== remote)
        await run(db, "DELETE FROM group_members WHERE group_id=?", group);
      await run(
        db,
        "INSERT INTO access_groups VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,google_group=excluded.google_group",
        group,
        d.name.trim().slice(0, 200),
        remote,
        d.batch_id,
      );
      const cfg = JSON.parse((await member(db, u, d.batch_id)).config || "{}");
      cfg.require_google_group = true;
      await run(
        db,
        "UPDATE batches SET config=? WHERE id=?",
        JSON.stringify(cfg),
        d.batch_id,
      );
      await queueJob(db, "google_group_update", d.batch_id, group, {
        google_group: remote,
        add: emails.filter((e) => !previous.some((p) => p.email === e)),
        remove: previous.map((p) => p.email).filter((e) => !emails.includes(e)),
      });
      const dispatched = await wakeEngine(env);
      return json({
        id: group,
        message: dispatched
          ? "Google Group update queued; access changes after verified sync."
          : "Group update queued. Configure the Azure engine and Workspace delegation to apply it.",
      });
    }
    await db.batch([
      db
        .prepare(
          "INSERT INTO access_groups VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,google_group=excluded.google_group",
        )
        .bind(
          group,
          d.name.trim().slice(0, 200),
          String(d.google_group || "").slice(0, 200),
          d.batch_id,
        ),
      db.prepare("DELETE FROM group_members WHERE group_id=?").bind(group),
      ...emails.map((email) =>
        db.prepare("INSERT INTO group_members VALUES (?,?)").bind(group, email),
      ),
    ]);
    for (const email of emails) {
      const person = await one(db, "SELECT id FROM users WHERE email=?", email);
      if (person)
        await run(
          db,
          "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
          uid(),
          person.id,
          d.batch_id,
          Number(d.fee) || 0,
          now(),
        );
    }
    return json({ id: group });
  }
  if (p === "/api/admin/sessions" && req.method === "POST") {
    admin(u);
    const d = await req.json(),
      b = await member(db, u, d.batch_id);
    if (d.action === "cancel" || d.action === "restore") {
      await run(
        db,
        "UPDATE content SET session_status=? WHERE kind='live' AND batch_id=? AND (id=? OR (?=1 AND series_id=?))",
        d.action === "cancel" ? "cancelled" : "scheduled",
        b.id,
        d.id,
        d.whole_series ? 1 : 0,
        d.series_id || "",
      );
      return json({ ok: true });
    }
    const dates = d.dates;
    if (
      !Array.isArray(dates) ||
      !dates.length ||
      dates.length > 180 ||
      dates.some((s) => isNaN(Date.parse(s)))
    )
      fail(400, "Choose 1–180 valid session dates.");
    if (!d.title?.trim()) fail(400, "Class name is required.");
    const series = uid();
    await db.batch(
      dates.map((date, i) =>
        db
          .prepare(
            "INSERT INTO content(id,course_id,batch_id,kind,title,topic,topic_order,body,url,starts_at,duration,published,created,series_id) VALUES (?,?,?,'live',?,?,?,?,?,?,?,1,?,?)",
          )
          .bind(
            uid(),
            b.course_id,
            b.id,
            d.title.replaceAll("{n}", String(i + 1)),
            String(d.topic || "Live class"),
            Math.max(1, Math.min(100, Number(d.topic_order) || 1)),
            String(d.body || "").slice(0, 5000),
            https(d.url),
            new Date(date).toISOString(),
            Math.max(1, Math.min(1440, Number(d.duration) || 60)),
            now(),
            series,
          ),
      ),
    );
    return json({ ok: true, count: dates.length });
  }
  if (p === "/api/admin/generate-test" && req.method === "POST") {
    admin(u);
    if (!env.AZURE_ENGINE_URL)
      fail(503, "Configure the Azure engine before generating assessments.");
    const d = await req.json(),
      b = await member(db, u, d.batch_id);
    if (!["daily", "weekly", "monthly", "topic"].includes(d.kind))
      fail(400, "Choose daily, weekly or monthly.");
    const ids = [...new Set(d.source_ids || [])];
    if (!ids.length || ids.length > 30)
      fail(400, "Choose 1–30 approved resources.");
    const selected = [];
    for (const id of ids) {
      const c = await one(
        db,
        "SELECT * FROM content WHERE id=? AND published=1 AND course_id=? AND (batch_id=? OR batch_id IS NULL)",
        id,
        b.course_id,
        b.id,
      );
      if (
        !c ||
        !["notes", "slides", "guide", "recording", "lab"].includes(c.kind)
      )
        fail(400, "Only approved learning materials are eligible.");
      selected.push(c);
    }
    const count = Number(d.count);
    if (!Number.isInteger(count) || count < 1 || count > 100)
      fail(400, "Choose 1–100 questions.");
    const types = [...new Set(d.question_types || ["mcq"])];
    if (
      !types.length ||
      types.some((t) => !QUESTION_TYPES[t]) ||
      types.length > count
    )
      fail(
        400,
        "Choose valid question types and at least one question per type.",
      );
    const id = await queueJob(db, "generate_test", b.id, uid(), {
      title: String(d.title || "Class assessment").slice(0, 200),
      kind: d.kind,
      count,
      question_types: types,
      duration: Math.max(1, Math.min(180, Number(d.duration) || 30)),
      course_id: b.course_id,
      topic_order: Math.max(...selected.map((c) => c.topic_order)),
      source_ids: ids,
    });
    await wakeEngine(env);
    return json({
      id,
      message: "Generation queued. Review the draft before publishing.",
    });
  }
  if (p === "/api/admin/extract-sop" && req.method === "POST") {
    admin(u);
    const d = await req.json(),
      b = await member(db, u, d.batch_id);
    const c = await one(
      db,
      "SELECT * FROM content WHERE id=? AND kind='sop' AND published=1 AND course_id=? AND (batch_id=? OR batch_id IS NULL)",
      d.content_id,
      b.course_id,
      b.id,
    );
    if (!c) fail(400, "Choose an approved SOP for this batch.");
    const id = await queueJob(db, "extract_sop", b.id, c.id, {
      content_id: c.id,
    });
    const dispatched = await wakeEngine(env);
    return json({ id, dispatched });
  }
  if (p === "/api/admin/apply-roadmap" && req.method === "POST") {
    admin(u);
    const d = await req.json(),
      j = await one(
        db,
        "SELECT * FROM engine_jobs WHERE id=? AND kind='extract_sop' AND status='complete'",
        d.job_id,
      );
    if (!j) fail(400, "Choose a completed SOP extraction.");
    const b = await member(db, u, j.batch_id),
      config = JSON.parse(b.config || "{}");
    config.roadmap = JSON.parse(j.result).roadmap;
    config.sop_content_id = j.entity_id;
    await run(
      db,
      "UPDATE batches SET config=? WHERE id=?",
      JSON.stringify(safeConfig(config)),
      b.id,
    );
    return json({ ok: true });
  }
  if (p === "/api/admin/job-result" && req.method === "GET") {
    admin(u);
    return json(
      await one(
        db,
        "SELECT id,status,result,error FROM engine_jobs WHERE id=?",
        new URL(req.url).searchParams.get("id"),
      ),
    );
  }
  if (p === "/api/admin/retry-job" && req.method === "POST") {
    admin(u);
    const d = await req.json();
    await run(
      db,
      "UPDATE engine_jobs SET status='pending',error=NULL,lease=NULL WHERE id=? AND status='failed'",
      d.id,
    );
    await wakeEngine(env);
    return json({ ok: true });
  }
  if (p.startsWith("/api/result-pdf/") && req.method === "GET") {
    const a = await one(
      db,
      "SELECT a.*,t.title,u.name FROM attempts a JOIN tests t ON t.id=a.test_id JOIN users u ON u.id=a.user_id WHERE a.id=?",
      p.split("/").pop(),
    );
    if (!a || !a.submitted || (u.role !== "admin" && a.user_id !== u.id))
      fail(404, "Result not found.");
    return resultPdf(a);
  }
  return null;
}
export async function engineRoutes(req, env) {
  const db = env.DB,
    p = new URL(req.url).pathname;
  if (p === "/api/automation/groups" && req.method === "GET")
    return json({
      groups: await rows(
        db,
        "SELECT * FROM access_groups WHERE google_group<>''",
      ),
    });
  if (p === "/api/automation/groups/snapshot" && req.method === "POST") {
    const d = await req.json(),
      g = await one(
        db,
        "SELECT * FROM access_groups WHERE id=? AND google_group=?",
        d.id,
        d.google_group,
      );
    if (!g) fail(409, "Group mapping changed.");
    if (
      !Array.isArray(d.members) ||
      d.members.length > 2000 ||
      d.members.some(
        (e) => typeof e !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
      )
    )
      fail(400, "Invalid group membership snapshot.");
    const emails = [...new Set(d.members.map((e) => e.toLowerCase()))];
    await db.batch([
      db.prepare("DELETE FROM group_members WHERE group_id=?").bind(g.id),
      ...emails.map((e) =>
        db.prepare("INSERT INTO group_members VALUES (?,?)").bind(g.id, e),
      ),
    ]);
    for (const email of emails) {
      const u = await one(db, "SELECT id FROM users WHERE email=?", email);
      if (u)
        await run(
          db,
          "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) SELECT ?,?,?,c.fee,? FROM courses c JOIN batches b ON b.course_id=c.id WHERE b.id=?",
          uid(),
          u.id,
          g.batch_id,
          now(),
          g.batch_id,
        );
    }
    return json({ ok: true });
  }
  if (!p.startsWith("/api/automation/jobs")) return null;
  if (req.method === "GET")
    return json({
      jobs: await rows(
        db,
        "SELECT id,kind FROM engine_jobs WHERE status='pending' OR (status='running' AND started<?) ORDER BY created LIMIT 30",
        new Date(Date.now() - 45 * 60000).toISOString(),
      ),
    });
  const d = await req.json();
  if (p.endsWith("/claim")) {
    const lease = uid();
    const r = await run(
      db,
      "UPDATE engine_jobs SET status='running',started=?,lease=? WHERE id=? AND (status='pending' OR (status='running' AND started<?))",
      now(),
      lease,
      d.id,
      new Date(Date.now() - 45 * 60000).toISOString(),
    );
    if (!r.meta?.changes) fail(409, "Job is already claimed.");
    const j = await one(db, "SELECT * FROM engine_jobs WHERE id=?", d.id),
      payload = JSON.parse(j.payload);
    if (j.kind === "generate_test") {
      payload.resources = [];
      for (const id of payload.source_ids) {
        const c = await one(
          db,
          "SELECT c.*,f.name AS file_name FROM content c LEFT JOIN files f ON f.id=c.file_id WHERE c.id=? AND c.published=1",
          id,
        );
        if (!c) fail(409, "A source is no longer approved.");
        payload.resources.push(c);
      }
    }
    if (j.kind === "extract_sop")
      payload.resources = [
        await one(
          db,
          "SELECT c.*,f.name AS file_name FROM content c LEFT JOIN files f ON f.id=c.file_id WHERE c.id=? AND c.published=1",
          j.entity_id,
        ),
      ];
    if (j.kind === "evaluate_test") {
      const a = await one(db, "SELECT * FROM attempts WHERE id=?", j.entity_id);
      payload.questions = JSON.parse(a.snapshot).questions;
      payload.answers = JSON.parse(a.answers);
      payload.score = a.score;
    }
    if (j.kind === "drive_submission") {
      const s = await one(
        db,
        "SELECT * FROM submissions WHERE id=?",
        j.entity_id,
      );
      payload.file = await one(db, "SELECT * FROM files WHERE id=?", s.file_id);
      const b = await one(
        db,
        "SELECT config FROM batches WHERE id=?",
        s.batch_id,
      );
      const explicit = JSON.parse(b.config || "{}").submission_folder;
      const source = await one(
        db,
        "SELECT folder_id FROM automation_sources WHERE batch_id=? AND enabled=1",
        s.batch_id,
      );
      payload.folder_id = explicit || source?.folder_id;
      payload.folder_is_batch_root = !explicit;
      payload.student_name =
        (await one(db, "SELECT name FROM users WHERE id=?", s.user_id))?.name ||
        "Student";
      payload.student_id = s.user_id;
      payload.submission_id = s.id;
    }
    return json({ ...j, payload });
  }
  const j = await one(
    db,
    "SELECT * FROM engine_jobs WHERE id=? AND lease=? AND status='running'",
    d.id,
    d.lease,
  );
  if (!j) fail(409, "Job lease is invalid.");
  if (d.error) {
    await run(
      db,
      "UPDATE engine_jobs SET status='failed',error=?,finished=? WHERE id=?",
      String(d.error).slice(0, 500),
      now(),
      j.id,
    );
    if (j.kind === "evaluate_test")
      await run(
        db,
        "UPDATE attempts SET grading_status='feedback_failed' WHERE id=?",
        j.entity_id,
      );
    if (j.kind === "drive_submission")
      await run(
        db,
        "UPDATE submissions SET drive_status='failed' WHERE id=?",
        j.entity_id,
      );
    return json({ ok: true });
  }
  if (JSON.stringify(d.result || {}).length > 200000)
    fail(400, "Job result is too large.");
  const result = d.result || {},
    payload = JSON.parse(j.payload);
  if (j.kind === "generate_test") {
    if (
      !Array.isArray(result.questions) ||
      result.questions.length !== payload.count ||
      result.questions.some((q) => !validQuestion(q))
    )
      fail(400, "Generated questions do not match the requested schema.");
    const qs = normalizeQuestions(result.questions).map((q) => ({
      ...q,
      topic: String(
        payload.kind === "topic"
          ? payload.topic
          : q.topic || payload.topic || "Class materials",
      ).slice(0, 200),
      subtopic: String(
        q.subtopic || q.topic || payload.topic || "Class materials",
      ).slice(0, 200),
    }));
    if (
      payload.question_types?.length &&
      payload.question_types.some((type) => !qs.some((q) => q.type === type))
    )
      fail(
        400,
        "The generated assessment is missing a requested question type.",
      );
    for (const id of payload.source_ids)
      if (
        !(await one(
          db,
          "SELECT id FROM content WHERE id=? AND published=1",
          id,
        ))
      )
        fail(409, "Source approval changed.");
    await run(
      db,
      "INSERT INTO tests(id,course_id,title,kind,topic_order,duration,questions,published,batch_id,source_ids,ai_generated) VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING",
      j.entity_id,
      payload.course_id,
      payload.title,
      payload.kind,
      payload.topic_order,
      payload.duration,
      JSON.stringify(qs),
      payload.automatic && payload.auto_publish ? 1 : 0,
      j.batch_id,
      JSON.stringify(payload.source_ids),
    );
  }
  if (j.kind === "evaluate_test") {
    const a = await one(db, "SELECT * FROM attempts WHERE id=?", j.entity_id),
      qs = JSON.parse(a.snapshot).questions,
      answers = JSON.parse(a.answers);
    if (!Array.isArray(result.feedback) || result.feedback.length !== qs.length)
      fail(400, "Feedback must cover every question.");
    let score = 0;
    const feedback = result.feedback.map((v, i) => {
      const q = qs[i],
        text = feedbackText(v);
      if (!text || text.length > 3000) fail(400, "Invalid feedback.");
      let marks = objectiveCorrect(q, answers[i]) ? q.marks : 0;
      if (written(q) && answers[i]) {
        if (
          typeof v !== "object" ||
          typeof v.marks !== "number" ||
          !Number.isFinite(v.marks) ||
          v.marks < 0 ||
          v.marks > q.marks
        )
          fail(
            400,
            "Written answer marks are outside the question allocation.",
          );
        marks = Math.round(v.marks * 100) / 100;
      }
      score += marks;
      return { feedback: text, marks, max_marks: q.marks };
    });
    await run(
      db,
      "UPDATE attempts SET feedback=?,score=?,grading_status='complete' WHERE id=?",
      JSON.stringify(feedback),
      Math.round(score * 100) / 100,
      j.entity_id,
    );
  }
  if (j.kind === "extract_sop") safeConfig({ roadmap: result.roadmap });
  if (j.kind === "drive_submission") {
    const url = https(result.url);
    if (!/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+/.test(url))
      fail(400, "Invalid uploaded Drive URL.");
    await run(
      db,
      "UPDATE submissions SET drive_url=?,drive_status='uploaded' WHERE id=?",
      url,
      j.entity_id,
    );
  }
  await run(
    db,
    "UPDATE engine_jobs SET status='complete',result=?,finished=? WHERE id=?",
    JSON.stringify(result),
    now(),
    j.id,
  );
  return json({ ok: true });
}
export async function engineFile(req, env) {
  const id = new URL(req.url).searchParams.get("file_id"),
    jobId = new URL(req.url).searchParams.get("job_id"),
    lease = new URL(req.url).searchParams.get("lease");
  const j = await one(
    env.DB,
    "SELECT * FROM engine_jobs WHERE id=? AND lease=? AND status='running'",
    jobId,
    lease,
  );
  if (!j) fail(403, "Active job required.");
  const payload = JSON.parse(j.payload);
  let allowed = [];
  if (j.kind === "drive_submission") {
    const s = await one(
      env.DB,
      "SELECT file_id FROM submissions WHERE id=?",
      j.entity_id,
    );
    allowed = [s?.file_id];
  } else {
    for (const cid of payload.source_ids || [payload.content_id]) {
      const c = await one(
        env.DB,
        "SELECT file_id FROM content WHERE id=? AND published=1",
        cid,
      );
      allowed.push(c?.file_id);
    }
  }
  if (!allowed.includes(id)) fail(403, "File is not a source for this job.");
  const obj = await env.BUCKET.get(id);
  if (!obj) fail(404, "File unavailable.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
async function resultPdf(a) {
  const doc = await PDFDocument.create(),
    regular = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold),
    navy = rgb(0.05, 0.25, 0.36);
  let page, y;
  const clean = (t) => String(t || "").replace(/[^\x20-\x7E\n]/g, " ");
  function newPage() {
    page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 785, width: 595, height: 57, color: navy });
    page.drawText("ARKS GLOBAL ASIA INSTITUTES", {
      x: 38,
      y: 805,
      size: 16,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText("LEARNING CAMPUS  |  Assessment report", {
      x: 38,
      y: 30,
      size: 9,
      font: regular,
      color: navy,
    });
    y = 755;
  }
  function text(s, strong = false) {
    const font = strong ? bold : regular;
    for (const paragraph of clean(s).split("\n")) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        if (font.widthOfTextAtSize(line + " " + word, 11) > 510 && line) {
          if (y < 65) newPage();
          page.drawText(line, { x: 38, y, size: 11, font, color: navy });
          y -= 17;
          line = "";
        }
        line += (line ? " " : "") + word;
      }
      if (y < 65) newPage();
      page.drawText(line, { x: 38, y, size: 11, font, color: navy });
      y -= 20;
    }
  }
  newPage();
  text(a.title, true);
  text("Student: " + a.name);
  text(
    "Score: " + a.score + " / " + a.total + " | Status: " + a.grading_status,
  );
  text("Submitted: " + a.submitted);
  const qs = JSON.parse(a.snapshot).questions,
    ans = JSON.parse(a.answers),
    feedback = JSON.parse(a.feedback || "[]");
  qs.forEach((q, i) => {
    y -= 10;
    text(`${i + 1}. ${q.prompt}`, true);
    text(
      "Marks: " +
        (feedback[i]?.marks ??
          (written(q)
            ? "Pending"
            : objectiveCorrect(q, ans[i])
              ? q.marks
              : 0)) +
        " / " +
        q.marks,
    );
    text("Your answer: " + answerText(q, ans[i]));
    text("Correct answer: " + answerText(q, q.answer, true));
    text(
      written(q)
        ? "Written response"
        : objectiveCorrect(q, ans[i])
          ? "Correct"
          : "Incorrect",
    );
    text(
      feedbackText(feedback[i]) ||
        q.explanation ||
        "Review the approved class materials.",
    );
  });
  return new Response(await doc.save(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'attachment; filename="Arks-assessment-result.pdf"',
      "Cache-Control": "private,no-store",
    },
  });
}
