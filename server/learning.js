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
  hash,
} from "./common.js";
import { queueJob, wakeEngine } from "./features.js";
import {
  QUESTION_TYPES,
  objectiveCorrect,
  written,
  feedbackText,
} from "../shared/assessment.js";

export const materialKinds = ["recording", "notes", "slides", "guide", "lab"];
const decode = (v, fallback = {}) => {
  try {
    return JSON.parse(v || "{}");
  } catch {
    return fallback;
  }
};
const titleKey = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();
export const officialResources = {
  git: ["https://git-scm.com/docs"],
  jenkins: ["https://www.jenkins.io/doc/"],
  docker: ["https://docs.docker.com/"],
  kubernetes: ["https://kubernetes.io/docs/"],
  terraform: ["https://developer.hashicorp.com/terraform/docs"],
  ansible: ["https://docs.ansible.com/"],
  linux: ["https://docs.kernel.org/"],
  azure: ["https://learn.microsoft.com/azure/"],
  aws: ["https://docs.aws.amazon.com/"],
  python: ["https://docs.python.org/3/"],
  github: ["https://docs.github.com/"],
  prometheus: ["https://prometheus.io/docs/"],
};
export function officialLinks(topic) {
  return Object.entries(officialResources)
    .filter(([key]) =>
      new RegExp("(^|[^a-z])" + key + "([^a-z]|$)", "i").test(topic),
    )
    .flatMap(([, urls]) => urls);
}
export async function sourcePolicy(db, id) {
  return decode(
    (
      await one(
        db,
        "SELECT value FROM settings WHERE key=?",
        "source-policy:" + id,
      )
    )?.value,
    {},
  );
}
export function excludedPath(path, id, policy = {}) {
  const parts = String(path || "")
    .replace(/^batch\/?/, "")
    .toLowerCase()
    .split("/");
  return (policy.exclusions || []).some(
    (v) =>
      v === id ||
      (v.includes("/")
        ? parts.join("/") === v.toLowerCase().replace(/^\/+|\/+$/g, "") ||
          parts
            .join("/")
            .startsWith(v.toLowerCase().replace(/^\/+|\/+$/g, "") + "/")
        : parts.includes(v.toLowerCase())),
  );
}
// Scope is keyed by lesson numbers and exact SOP mapping, never filename keywords.
export function assessmentScopes(batch, course, content, pending = []) {
  const cfg = decode(batch.config),
    auto = cfg.assessment_automation || {};
  if (auto.enabled === false) return [];
  const roadmap = cfg.roadmap?.length
    ? cfg.roadmap
    : decode(course.syllabus, []);
  const required = auto.required_kinds?.length
    ? auto.required_kinds
    : ["recording", "notes", "slides", "lab"];
  const approved = content.filter(
    (c) => c.published && materialKinds.includes(c.kind),
  );
  const days = [...new Set(approved.map((c) => Number(c.topic_order)))].sort(
    (a, b) => a - b,
  );
  const mapped = (day) => {
    const explicit = auto.lesson_topics?.[day];
    if (
      explicit &&
      roadmap.some((r) => titleKey(r.title) === titleKey(explicit))
    )
      return explicit;
    const names = [
      ...new Set(
        approved
          .filter((c) => Number(c.topic_order) === day)
          .map((c) => titleKey(c.topic)),
      ),
    ];
    const r = roadmap.filter((r) => names.includes(titleKey(r.title)));
    return r.length === 1 ? r[0].title : null;
  };
  const ready = (day) =>
    required.every((kind) =>
      approved.some((c) => Number(c.topic_order) === day && c.kind === kind),
    ) &&
    !pending.some(
      (c) =>
        Number(c.topic_order) === day &&
        c.status === "pending" &&
        materialKinds.includes(c.kind),
    );
  const scopes = [];
  for (const day of days.filter(ready))
    scopes.push({
      key: "daily:" + day,
      kind: "daily",
      title: "Daily assessment · Class " + day,
      days: [day],
      topic: mapped(day) || "Class " + day,
    });
  const size = Math.max(1, Math.min(30, Number(auto.week_size) || 7));
  for (let end = size; end <= Math.max(0, ...days); end += size) {
    const range = Array.from({ length: size }, (_, i) => end - size + i + 1);
    if (range.every(ready))
      scopes.push({
        key: "weekly:" + end,
        kind: "weekly",
        title: "Weekly assessment · Classes " + range[0] + "–" + end,
        days: range,
        topic: "Week " + end / size,
      });
  }
  for (let index = 0; index < roadmap.length; index++) {
    const topic = roadmap[index].title;
    const expected = Object.entries(auto.lesson_topics || {})
      .filter(([, name]) => titleKey(name) === titleKey(topic))
      .map(([day]) => Number(day));
    const topicDays = [
      ...new Set([
        ...expected,
        ...days.filter((day) => titleKey(mapped(day)) === titleKey(topic)),
      ]),
    ].sort((a, b) => a - b);
    const nextPublished = days.some(
      (day) =>
        topicDays.length &&
        day > Math.max(...topicDays) &&
        roadmap.findIndex((r) => titleKey(r.title) === titleKey(mapped(day))) >
          index,
    );
    const marked = (auto.completed_topics || []).some(
      (t) => titleKey(t) === titleKey(topic),
    );
    if (topicDays.length && topicDays.every(ready) && (nextPublished || marked))
      scopes.push({
        key: "topic:" + index,
        kind: "topic",
        title: topic + " · Topic assessment",
        days: topicDays,
        topic,
      });
  }
  return scopes.map((s) => ({
    ...s,
    resources: approved.filter((c) => s.days.includes(Number(c.topic_order))),
  }));
}
export async function planAssessments(env, batchId) {
  const db = env.DB,
    b = await one(db, "SELECT * FROM batches WHERE id=?", batchId);
  if (!b || b.status === "archived") return { queued: 0 };
  if (
    await one(
      db,
      "SELECT id FROM automation_sources WHERE batch_id=? AND status='scanning'",
      b.id,
    )
  )
    return { queued: 0 };
  const course = await one(db, "SELECT * FROM courses WHERE id=?", b.course_id);
  const content = await rows(
    db,
    "SELECT * FROM content WHERE course_id=? AND (batch_id=? OR batch_id IS NULL)",
    b.course_id,
    b.id,
  );
  const pending = await rows(
    db,
    "SELECT i.* FROM import_items i JOIN automation_sources s ON s.id=i.source_id WHERE s.batch_id=? AND i.generation=s.generation AND i.status='pending'",
    b.id,
  );
  const cfg = decode(b.config),
    auto = cfg.assessment_automation || {};
  const scopes = assessmentScopes(b, course, content, pending);
  const covered = Math.max(
    0,
    ...scopes.filter((s) => s.kind === "daily").flatMap((s) => s.days),
  );
  if (covered)
    await run(
      db,
      "UPDATE batches SET covered=CASE WHEN covered<? THEN ? ELSE covered END WHERE id=?",
      covered,
      covered,
      b.id,
    );
  let queued = 0;
  for (const scope of scopes) {
    const key = "auto:" + (await hash(b.id + "\n" + scope.key));
    // Stable primary key gives exactly one generation request per batch/scope, including concurrent releases.
    const existing = await one(
      db,
      "SELECT id FROM engine_jobs WHERE id=?",
      key,
    );
    if (existing) continue;
    const resources = scope.resources;
    const payload = {
      title: scope.title,
      kind: scope.kind,
      count: Math.max(11, Math.min(100, Number(auto.question_count) || 12)),
      question_types: Object.keys(QUESTION_TYPES),
      duration: 30,
      course_id: b.course_id,
      topic_order: Math.max(...scope.days),
      source_ids: resources.map((c) => c.id),
      topic: scope.topic,
      automatic: true,
      auto_publish: auto.auto_publish !== false,
    };
    const result = await run(
      db,
      "INSERT INTO engine_jobs(id,kind,batch_id,entity_id,payload,created) VALUES (?,'generate_test',?,?,?,?) ON CONFLICT(id) DO NOTHING",
      key,
      b.id,
      key,
      JSON.stringify(payload),
      now(),
    );
    if (result.meta?.changes) queued++;
  }
  return {
    queued,
    engine_connected: !!(env.AZURE_ENGINE_URL && env.AZURE_ENGINE_KEY),
  };
}
export async function learningRoutes(req, env, u) {
  const p = new URL(req.url).pathname,
    db = env.DB;
  if (p === "/api/admin/enroll-student" && req.method === "POST") {
    admin(u);
    const d = await req.json();
    const b = await member(db, u, d.batch_id);
    const person = await one(db, "SELECT * FROM users WHERE id=?", d.user_id);
    if (!person || person.role !== "student")
      fail(400, "Choose a student account.");
    const c = await one(db, "SELECT fee FROM courses WHERE id=?", b.course_id),
      fee = d.fee === undefined ? c.fee : Number(d.fee);
    if (!Number.isSafeInteger(fee) || fee < 0)
      fail(400, "Enter a valid fee in paise.");
    await db.batch([
      db
        .prepare(
          "INSERT INTO invitations(id,email,batch_id,role,fee) VALUES (?,?,?,'student',?) ON CONFLICT(email,batch_id) DO UPDATE SET fee=excluded.fee",
        )
        .bind(uid(), person.email, b.id, fee),
      db
        .prepare(
          "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
        )
        .bind(uid(), person.id, b.id, fee, now()),
      db
        .prepare(
          "INSERT INTO audit(id,actor,action,entity,created) VALUES (?,?,?,?,?)",
        )
        .bind(uid(), u.id, "assign:batch", person.id + ":" + b.id, now()),
    ]);
    return json({ ok: true, message: "Student assigned to " + b.name + "." });
  }
  if (p === "/api/admin/draft") {
    admin(u);
    const key =
      req.method === "GET"
        ? new URL(req.url).searchParams.get("key")
        : (await req.clone().json()).key;
    if (!/^[\w:.-]{1,200}$/.test(key || "")) fail(400, "Invalid draft key.");
    const name = "draft:" + u.id + ":" + key;
    if (req.method === "GET")
      return json({
        draft: decode(
          (await one(db, "SELECT value FROM settings WHERE key=?", name))
            ?.value,
          null,
        ),
      });
    if (req.method === "POST") {
      const d = await req.json();
      if (JSON.stringify(d.value).length > 150000)
        fail(400, "Draft is too large.");
      if (
        JSON.stringify(d.value).match(
          /\"(?:password|secret|token|api_key|client_secret)\"\s*:/i,
        )
      )
        fail(400, "Secrets cannot be saved as drafts.");
      await run(
        db,
        "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        name,
        JSON.stringify(d.value),
      );
      return json({ ok: true });
    }
  }
  if (p === "/api/admin/plan-assessments" && req.method === "POST") {
    admin(u);
    const d = await req.json();
    await member(db, u, d.batch_id);
    const result = await planAssessments(env, d.batch_id);
    let dispatched = false;
    try {
      dispatched = await wakeEngine(env);
    } catch {}
    return json({
      ...result,
      dispatched,
      message:
        result.queued +
        " assessments queued. " +
        (dispatched
          ? "Azure notified."
          : "Connect the Azure worker to process jobs."),
    });
  }
  if (p === "/api/performance" && req.method === "GET") {
    const batchId = new URL(req.url).searchParams.get("batch");
    const b = await member(db, u, batchId);
    const attempts = await rows(
      db,
      "SELECT a.*,t.title,t.kind,t.source_ids FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.user_id=? AND a.batch_id=? AND a.submitted IS NOT NULL ORDER BY a.submitted DESC",
      u.id,
      batchId,
    );
    const resources = await rows(
      db,
      "SELECT id,title,topic,kind,url,file_id,topic_order FROM content WHERE published=1 AND course_id=? AND (batch_id=? OR batch_id IS NULL)",
      b.course_id,
      b.id,
    );
    return json({
      attempts: attempts.map((a) => {
        const qs = decode(a.snapshot).questions || [],
          answers = decode(a.answers, []),
          feedback = decode(a.feedback, []),
          ids = decode(a.source_ids, []);
        return {
          id: a.id,
          title: a.title,
          kind: a.kind,
          score: a.score,
          total: a.total,
          submitted: a.submitted,
          grading_status: a.grading_status,
          questions: qs.map((q, i) => {
            const topic = String(
                q.topic ||
                  resources.find((r) => ids.includes(r.id))?.topic ||
                  "Class materials",
              ).slice(0, 200),
              subtopic = String(q.subtopic || topic).slice(0, 200);
            const marks =
              feedback[i]?.marks ??
              (written(q)
                ? null
                : objectiveCorrect(q, answers[i])
                  ? q.marks
                  : 0);
            return {
              number: i + 1,
              prompt: q.prompt,
              topic,
              subtopic,
              type: q.type || "mcq",
              marks,
              max_marks: q.marks,
              explanation: feedbackText(feedback[i]) || q.explanation || "",
              resources: resources
                .filter(
                  (r) =>
                    ids.includes(r.id) &&
                    (titleKey(r.topic) === titleKey(topic) ||
                      !resources.some(
                        (source) =>
                          ids.includes(source.id) &&
                          titleKey(source.topic) === titleKey(topic),
                      )),
                )
                .map((r) => ({
                  title: r.title,
                  url: r.file_id ? "/api/files/" + r.file_id : r.url,
                }))
                .filter((r) => r.url),
              official_links: officialLinks(topic),
            };
          }),
        };
      }),
    });
  }
  return null;
}
