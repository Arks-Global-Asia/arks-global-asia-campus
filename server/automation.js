import { engineRoutes, engineFile, wakeEngine } from "./features.js";
import { staff, istDateInfo } from "./common.js";

const now = () => new Date().toISOString(),
  uuid = () => crypto.randomUUID();
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const one = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .first();
const all = async (db, q, ...v) =>
  (
    await db
      .prepare(q)
      .bind(...v)
      .all()
  ).results;
const run = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .run();
const response = (v) =>
  Response.json(v, { headers: { "Cache-Control": "no-store" } });
const text = (v, label, max = 500) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, `${label} is required (max ${max} characters).`);
  return v.trim();
};
const fileId = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{10,200}$/.test(v);

export const STUDENT_CONTENT_KINDS = [
  "notes",
  "slides",
  "lab",
  "guide",
  "recording",
  "image",
  "sop",
  "test_link",
];

export const DEFAULT_EXCLUDED_FOLDERS = [
  "do_not_share",
  "trainer_only",
  "lab_answers",
  "student_submissions",
];

export function parseSourceConfig(raw) {
  let parsed = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }
  const excluded_folders = Array.isArray(parsed.excluded_folders)
    ? [
        ...new Set(
          parsed.excluded_folders
            .map((x) =>
              String(x || "")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "_"),
            )
            .filter(Boolean),
        ),
      ]
    : [...DEFAULT_EXCLUDED_FOLDERS];
  const excluded_extensions = Array.isArray(parsed.excluded_extensions)
    ? [
        ...new Set(
          parsed.excluded_extensions
            .map((x) =>
              String(x || "")
                .trim()
                .toLowerCase()
                .replace(/^\.+/, ""),
            )
            .filter(Boolean),
        ),
      ]
    : [];
  const auto_daily_test =
    parsed.auto_daily_test === undefined ? true : Boolean(parsed.auto_daily_test);
  return {
    excluded_folders,
    excluded_extensions,
    auto_daily_test,
  };
}

export function folderInput(value) {
  value = text(value, "Drive folder", 300);
  if (/^https?:/i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail(400, "Enter a Google Drive folder link or exact folder name.");
    }
    const match = url.pathname.match(
      /^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/,
    );
    if (
      url.protocol !== "https:" ||
      url.hostname !== "drive.google.com" ||
      !match ||
      !fileId(match[1])
    )
      fail(400, "Use a Google Drive folder link.");
    return { input: value, id: match[1] };
  }
  return { input: value, id: null };
}

export function classifyMaterial(name, path, mime = "", sourceConfig = {}) {
  const cfg = parseSourceConfig(sourceConfig);
  const lowerName = String(name || "").toLowerCase();
  const lowerPath = String(path || "").toLowerCase();
  const s = (lowerPath + "/" + lowerName).toLowerCase();

  // Check per-source excluded folders
  const segments = lowerPath
    .split("/")
    .map((seg) => seg.trim().replace(/\s+/g, "_"))
    .filter(Boolean);
  if (segments.some((seg) => cfg.excluded_folders.includes(seg))) {
    return "private";
  }

  // Check per-source excluded extensions
  if (
    cfg.excluded_extensions.length &&
    cfg.excluded_extensions.some((ext) => lowerName.endsWith("." + ext))
  ) {
    return "private";
  }

  if (
    /(^|[\s/_.-])(answers?|solutions?|rubrics?|results?|responses?|grading|instructor|trainer|trainer_only|do_not_share|keys?)([\s/_.-]|$)/.test(
      s,
    ) ||
    mime === "application/vnd.google-apps.spreadsheet"
  )
    return "private";
  if (/(^|[\s/_.-])(draft|temp|unfinished|working)([\s/_.-]|$)/.test(s))
    return "private";
  if (
    mime === "application/vnd.google-apps.form" ||
    /knowledge_tests|quiz|assessment|test_questions/.test(s)
  )
    return "test_link";
  if (
    /recording/.test(s) ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  )
    return "recording";
  if (/lab_questions|(^|[ /_-])labs?([ /_.-]|$)/.test(s)) return "lab";
  if (/resource_creation|guide|runbook|cheatsheet/.test(s)) return "guide";
  if (/sop|checklist/.test(s)) return "sop";
  if (/\.pptx?$/.test(s) || mime === "application/vnd.google-apps.presentation")
    return "slides";
  if (/\.(png|jpe?g|webp|svg)$/.test(s) || mime.startsWith("image/"))
    return "image";
  if (
    /notes|\.(pdf|docx?|md|txt|ya?ml|sh|py|json|zip|csv|xlsx)$/.test(s) ||
    mime === "application/vnd.google-apps.document"
  )
    return "notes";
  return "private";
}

function driveUrl(value, id) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail(400, "Invalid Drive URL.");
  }
  if (
    u.protocol !== "https:" ||
    !["drive.google.com", "docs.google.com"].includes(u.hostname) ||
    !u.pathname.split("/").includes(id)
  )
    fail(400, "URL must identify the imported Drive file.");
  return u.href;
}

function lesson(name, path = "") {
  const combined = `${path}/${name}`;
  const m = combined.match(/(?:day|lesson|topic|module)[ _-]*0*(\d{1,3})/i);
  return m ? Number(m[1]) : 1;
}

function extractClassDate(item) {
  if (
    typeof item.class_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.class_date)
  ) {
    return item.class_date;
  }
  const combined = `${item.source_path || ""} ${item.name || ""}`;
  const isoMatch = combined.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const ts = item.modified_time || item.revision || "";
  if (typeof ts === "string" && /^\d{4}-\d{2}-\d{2}T/.test(ts)) {
    return istDateInfo(ts).dateKey;
  }
  return istDateInfo().dateKey;
}

export async function saveSource(
  db,
  batchId,
  input,
  enabled = true,
  configInput = null,
) {
  if (!(await one(db, "SELECT id FROM batches WHERE id=?", batchId)))
    fail(400, "Choose an existing batch.");
  const parsed = folderInput(input),
    old = await one(
      db,
      "SELECT * FROM automation_sources WHERE batch_id=?",
      batchId,
    );
  const mergedConfig = JSON.stringify(
    parseSourceConfig(configInput !== null ? configInput : old?.config),
  );
  if (old) {
    const changed = old.folder_input !== parsed.input;
    await run(
      db,
      `UPDATE automation_sources SET folder_input=?,folder_id=?,folder_name=?,enabled=?,status=?,last_error=?,sync_requested=1,generation=generation+?,config=? WHERE id=?`,
      parsed.input,
      changed ? parsed.id : old.folder_id,
      changed ? null : old.folder_name,
      enabled ? 1 : 0,
      changed ? "pending" : old.status,
      changed ? null : old.last_error,
      changed ? 1 : 0,
      mergedConfig,
      old.id,
    );
    if (changed) {
      await db.batch([
        db
          .prepare(
            "UPDATE import_runs SET status='failed',finished=?,message='Source folder changed; scan cancelled.' WHERE source_id=? AND status='running'",
          )
          .bind(now(), old.id),
        db
          .prepare(
            "UPDATE import_items SET status='superseded',review_note='Source folder changed before review.' WHERE source_id=? AND generation=? AND status='pending'",
          )
          .bind(old.id, old.generation),
      ]);
    }
    return old.id;
  }
  const id = uuid();
  await run(
    db,
    "INSERT INTO automation_sources (id,batch_id,folder_input,folder_id,enabled,config,created) VALUES (?,?,?,?,?,?,?)",
    id,
    batchId,
    parsed.input,
    parsed.id,
    enabled ? 1 : 0,
    mergedConfig,
    now(),
  );
  return id;
}

async function audit(db, actor, action, entity) {
  await run(
    db,
    "INSERT INTO audit (id,actor,action,entity,created) VALUES (?,?,?,?,?)",
    uuid(),
    actor,
    action,
    entity,
    now(),
  );
}

export async function automationState(db) {
  return {
    sources: await all(
      db,
      "SELECT s.*,b.name batch_name,b.course_id FROM automation_sources s JOIN batches b ON b.id=s.batch_id ORDER BY s.created DESC",
    ),
    items: await all(
      db,
      "SELECT i.*,s.batch_id,b.name batch_name FROM import_items i JOIN automation_sources s ON s.id=i.source_id JOIN batches b ON b.id=s.batch_id ORDER BY i.created DESC LIMIT 500",
    ),
    runs: await all(
      db,
      "SELECT r.*,b.name batch_name FROM import_runs r JOIN automation_sources s ON s.id=r.source_id JOIN batches b ON b.id=s.batch_id ORDER BY r.started DESC LIMIT 100",
    ),
  };
}

export async function adminAutomation(req, env, u) {
  staff(u);
  const db = env.DB,
    p = new URL(req.url).pathname;
  const runtime = { importer_configured: !!env.IMPORTER_TOKEN_SHA256 };
  if (p.endsWith("/state") && req.method === "GET")
    return response({ ...(await automationState(db)), ...runtime });
  if (req.method !== "POST") fail(405, "Method not allowed.");
  const d = await req.json();
  if (p.endsWith("/source")) {
    const id = await saveSource(
      db,
      d.batch_id,
      d.folder_input,
      d.enabled !== false,
      d.config !== undefined ? d.config : null,
    );
    await audit(db, u.id, "save:automation_source", id);
    return response({ id });
  }
  if (p.endsWith("/queue") || p.endsWith("/sync")) {
    const source = await one(
      db,
      "SELECT * FROM automation_sources WHERE id=?",
      d.source_id,
    );
    if (!source) fail(404, "Source not found.");
    if (!source.enabled)
      fail(400, "Enable this source before requesting a scan.");
    await run(
      db,
      "UPDATE automation_sources SET sync_requested=1 WHERE id=?",
      source.id,
    );
    const dispatched = p.endsWith("/sync")
      ? await wakeEngine(env, source.id)
      : false;
    return response({
      ok: true,
      dispatched,
      message: dispatched
        ? "Azure accepted an immediate scan. Check Run history for completion."
        : "Queued for the next scheduled scan. Configure the Azure engine endpoint to enable immediate Sync Up.",
    });
  }
  if (p.endsWith("/review")) {
    const i = await one(
      db,
      "SELECT i.*,s.batch_id,s.generation current_generation,b.course_id FROM import_items i JOIN automation_sources s ON s.id=i.source_id JOIN batches b ON b.id=s.batch_id WHERE i.id=?",
      d.id,
    );
    if (!i) fail(404, "Import not found.");
    if (i.generation !== i.current_generation)
      fail(409, "The source folder changed. Review a current import.");

    // Support category override if staff explicitly chooses a valid student-facing kind
    const requestedKind = d.kind || d.override_kind || null;
    const hasValidOverride =
      requestedKind && STUDENT_CONTENT_KINDS.includes(requestedKind);

    if (d.action === "reject") {
      if (i.status !== "pending" && i.status !== "restricted")
        fail(409, "This revision has already been reviewed or is restricted.");
      await run(
        db,
        "UPDATE import_items SET status='rejected',kind=COALESCE(?,kind),review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?",
        requestedKind === "private" ? "private" : null,
        String(d.note || "").slice(0, 2000),
        u.id,
        now(),
        i.id,
      );
      await audit(db, u.id, "reject:import", i.id);
      return response({ ok: true });
    }

    if (
      i.status !== "pending" &&
      !(i.status === "restricted" && hasValidOverride)
    )
      fail(409, "This revision has already been reviewed or is restricted.");

    if (d.action !== "approve") fail(400, "Choose approve or reject.");
    if (d.confirmed_student_safe !== true)
      fail(
        400,
        "Review the file and confirm that it is safe to share with students.",
      );
    const effectiveKind = hasValidOverride ? requestedKind : i.kind;
    if (effectiveKind === "private")
      fail(
        403,
        "Instructor material and result workbooks cannot be published to students.",
      );
    const newer = await one(
      db,
      "SELECT id FROM import_items WHERE source_id=? AND generation=? AND drive_file_id=? AND created>?",
      i.source_id,
      i.generation,
      i.drive_file_id,
      i.created,
    );
    if (newer)
      fail(409, "A newer revision is available. Review the latest revision.");
    const order = Number(d.topic_order || i.topic_order);
    if (!Number.isInteger(order) || order < 1 || order > 100)
      fail(400, "Topic number must be between 1 and 100.");
    let url = i.source_url;
    if (effectiveKind === "test_link") {
      try {
        const parsed = new URL(d.student_url);
        if (
          parsed.protocol !== "https:" ||
          parsed.hostname !== "docs.google.com" ||
          !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform$/.test(parsed.pathname)
        )
          throw 0;
        url = parsed.href;
      } catch {
        fail(
          400,
          "Paste the published Google Form student link ending in /viewform.",
        );
      }
    }
    const previous = await one(
      db,
      "SELECT content_id FROM import_items WHERE source_id=? AND generation=? AND drive_file_id=? AND content_id IS NOT NULL ORDER BY reviewed_at DESC LIMIT 1",
      i.source_id,
      i.generation,
      i.drive_file_id,
    );
    const cid = previous?.content_id || uuid(),
      title = text(d.title || i.title, "Title", 200),
      topic = text(d.topic || i.topic, "Topic", 200);
    const instructions = String(d.body || "").slice(0, 30000);
    const timestamp = now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO content (id,course_id,batch_id,kind,title,topic,topic_order,body,url,starts_at,duration,file_id,published,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,topic=excluded.topic,topic_order=excluded.topic_order,body=excluded.body,url=excluded.url,file_id=excluded.file_id,published=1",
        )
        .bind(
          cid,
          i.course_id,
          i.batch_id,
          effectiveKind,
          title,
          topic,
          order,
          instructions,
          i.file_id && effectiveKind !== "test_link" ? "" : url,
          "",
          60,
          effectiveKind === "test_link" ? null : i.file_id,
          1,
          timestamp,
        ),
      db
        .prepare(
          "UPDATE import_items SET status='superseded' WHERE source_id=? AND generation=? AND drive_file_id=? AND status='published'",
        )
        .bind(i.source_id, i.generation, i.drive_file_id),
      db
        .prepare(
          "UPDATE import_items SET status='published',kind=?,content_id=?,title=?,topic=?,topic_order=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?",
        )
        .bind(
          effectiveKind,
          cid,
          title,
          topic,
          order,
          String(d.note || "").slice(0, 2000),
          u.id,
          timestamp,
          i.id,
        ),
      db
        .prepare(
          "INSERT INTO audit (id,actor,action,entity,created) VALUES (?,?,?,?,?)",
        )
        .bind(uuid(), u.id, "publish:import", i.id, timestamp),
    ]);
    return response({ ok: true, content_id: cid });
  }
  if (p.endsWith("/approve-batch")) {
    if (d.confirmed_student_safe !== true)
      fail(
        400,
        "Confirm that the selected items are safe to publish to students.",
      );
    let candidates = [];
    if (Array.isArray(d.item_ids) && d.item_ids.length) {
      for (const itemId of d.item_ids.slice(0, 100)) {
        const row = await one(
          db,
          "SELECT i.*,s.batch_id,s.generation current_generation,b.course_id FROM import_items i JOIN automation_sources s ON s.id=i.source_id JOIN batches b ON b.id=s.batch_id WHERE i.id=?",
          itemId,
        );
        if (row) candidates.push(row);
      }
    } else if (d.batch_id) {
      candidates = await all(
        db,
        "SELECT i.*,s.batch_id,s.generation current_generation,b.course_id FROM import_items i JOIN automation_sources s ON s.id=i.source_id JOIN batches b ON b.id=s.batch_id WHERE s.batch_id=? AND i.status='pending' AND i.generation=s.generation ORDER BY i.created ASC",
        d.batch_id,
      );
      if (d.class_date) {
        candidates = candidates.filter((c) => c.class_date === d.class_date);
      }
    } else {
      fail(400, "Specify batch_id or item_ids for bunch approval.");
    }

    const eligible = candidates.filter(
      (i) =>
        i.status === "pending" &&
        i.generation === i.current_generation &&
        STUDENT_CONTENT_KINDS.includes(i.kind) &&
        i.kind !== "test_link",
    );
    if (!eligible.length)
      fail(400, "No pending student-safe items matched for bunch approval.");

    const contentIds = [];
    const timestamp = now();
    for (const i of eligible) {
      const newer = await one(
        db,
        "SELECT id FROM import_items WHERE source_id=? AND generation=? AND drive_file_id=? AND created>?",
        i.source_id,
        i.generation,
        i.drive_file_id,
        i.created,
      );
      if (newer) continue;
      const previous = await one(
        db,
        "SELECT content_id FROM import_items WHERE source_id=? AND generation=? AND drive_file_id=? AND content_id IS NOT NULL ORDER BY reviewed_at DESC LIMIT 1",
        i.source_id,
        i.generation,
        i.drive_file_id,
      );
      const cid = previous?.content_id || uuid();
      const order = Number(d.topic_order || i.topic_order) || 1;
      const topic = String(
        d.topic ||
          (i.topic === "Needs topic review" ? `Topic ${order}` : i.topic),
      ).slice(0, 200);
      const title = String(i.title || "Class material").slice(0, 200);

      await db.batch([
        db
          .prepare(
            "INSERT INTO content (id,course_id,batch_id,kind,title,topic,topic_order,body,url,starts_at,duration,file_id,published,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,topic=excluded.topic,topic_order=excluded.topic_order,url=excluded.url,file_id=excluded.file_id,published=1",
          )
          .bind(
            cid,
            i.course_id,
            i.batch_id,
            i.kind,
            title,
            topic,
            Math.min(100, Math.max(1, order)),
            "",
            i.file_id ? "" : i.source_url,
            "",
            60,
            i.file_id,
            1,
            timestamp,
          ),
        db
          .prepare(
            "UPDATE import_items SET status='superseded' WHERE source_id=? AND generation=? AND drive_file_id=? AND status='published'",
          )
          .bind(i.source_id, i.generation, i.drive_file_id),
        db
          .prepare(
            "UPDATE import_items SET status='published',content_id=?,topic=?,topic_order=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?",
          )
          .bind(
            cid,
            topic,
            Math.min(100, Math.max(1, order)),
            String(d.note || "Bunch approved").slice(0, 2000),
            u.id,
            timestamp,
            i.id,
          ),
      ]);
      contentIds.push(cid);
    }
    await audit(
      db,
      u.id,
      "approve_batch:import",
      d.batch_id || eligible[0].batch_id,
    );
    return response({
      ok: true,
      approved_count: contentIds.length,
      content_ids: contentIds,
    });
  }
  fail(404, "Automation action not found.");
}

async function authenticate(req, env) {
  const token = req.headers.get("X-Arks-Importer-Token");
  if (!env.IMPORTER_TOKEN_SHA256 || !token || token.length > 8000)
    fail(401, "Automation credentials are missing or invalid.");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hash.length !== env.IMPORTER_TOKEN_SHA256.length)
    fail(401, "Automation credentials are invalid.");
  let diff = 0;
  for (let i = 0; i < hash.length; i++)
    diff |= hash.charCodeAt(i) ^ env.IMPORTER_TOKEN_SHA256.charCodeAt(i);
  if (diff) fail(401, "Automation credentials are invalid.");
}

async function activeRun(db, id) {
  const r = await one(
    db,
    "SELECT r.*,s.folder_id,s.enabled,s.config source_config,s.generation current_generation FROM import_runs r JOIN automation_sources s ON s.id=r.source_id WHERE r.id=?",
    id,
  );
  if (
    !r ||
    r.status !== "running" ||
    !r.enabled ||
    r.generation !== r.current_generation ||
    Date.now() - Date.parse(r.started) > 50 * 60000
  )
    fail(409, "The scan is no longer active. Claim a new scan.");
  return r;
}

export async function serviceAutomation(req, env) {
  await authenticate(req, env);
  if (new URL(req.url).pathname === "/api/automation/job-file")
    return engineFile(req, env);
  const jobResponse = await engineRoutes(req, env);
  if (jobResponse) return jobResponse;
  const p = new URL(req.url).pathname,
    db = env.DB;
  if (req.method === "GET" && p.endsWith("/sources"))
    return response({
      sources: (await automationState(db)).sources,
      policy:
        "Import drafts only. Never publish, change grades or modify student records.",
      version: 2,
    });
  if (req.method === "GET" && p.endsWith("/state"))
    return response(await automationState(db));
  if (req.method !== "POST") fail(405, "Method not allowed.");
  if (p.endsWith("/upload")) {
    const form = await req.formData(),
      itemId = form.get("item_id"),
      file = form.get("file");
    await activeRun(db, form.get("run_id"));
    const item = await one(db, "SELECT * FROM import_items WHERE id=?", itemId),
      r = await activeRun(db, form.get("run_id"));
    if (
      !item ||
      item.source_id !== r.source_id ||
      item.generation !== r.generation
    )
      fail(400, "File must belong to this scan.");
    if (item.status !== "pending" || item.kind === "private")
      fail(409, "This item cannot receive a student attachment.");
    if (
      !file ||
      typeof file === "string" ||
      file.size < 1 ||
      file.size > 20 * 1024 * 1024
    )
      fail(400, "File must be between 1 byte and 20 MB.");
    if (
      !/\.(pdf|pptx|ppt|docx|doc|txt|md|png|jpg|jpeg|webp|svg|zip|xlsx|csv|yaml|yml|sh|py|json)$/i.test(
        file.name,
      )
    )
      fail(400, "Unsupported attachment format.");
    if (item.file_id)
      return response({ file_id: item.file_id, duplicate: true });
    const fid = uuid();
    await env.BUCKET.put(fid, await file.arrayBuffer());
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO files (id,owner_id,name,mime,size,created) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            fid,
            "automation",
            file.name.slice(0, 200),
            file.type || "application/octet-stream",
            file.size,
            now(),
          ),
        db
          .prepare(
            "UPDATE import_items SET file_id=?,warning=? WHERE id=? AND file_id IS NULL",
          )
          .bind(
            fid,
            "Review the imported document, including any presenter notes, before releasing it.",
            item.id,
          ),
      ]);
    } catch (e) {
      await env.BUCKET.delete(fid);
      throw e;
    }
    return response({ file_id: fid });
  }
  const d = await req.json();
  if (p.endsWith("/prepare")) {
    const name = text(d.batch_name, "Batch name", 200);
    const courses = await all(
      db,
      "SELECT id FROM courses WHERE id=?",
      d.course_id,
    );
    if (!courses.length)
      fail(
        409,
        "Open the campus once as owner to initialize the course before configuring automation.",
      );
    let b = await one(
      db,
      "SELECT * FROM batches WHERE name=? AND course_id=?",
      name,
      d.course_id,
    );
    if (!b) {
      b = { id: uuid() };
      await run(
        db,
        "INSERT INTO batches (id,course_id,name,start_date,end_date,timezone,covered,status) VALUES (?,?,?,?,?,?,?,?)",
        b.id,
        d.course_id,
        name,
        "",
        "",
        "Asia/Kolkata",
        0,
        "upcoming",
      );
    }
    const source_id = await saveSource(db, b.id, d.folder_input, true);
    await audit(db, "automation", "configure:batch_source", source_id);
    return response({ batch_id: b.id, source_id });
  }
  if (p.endsWith("/claim")) {
    const s = await one(
      db,
      "SELECT * FROM automation_sources WHERE id=?",
      d.source_id,
    );
    if (!s || !s.enabled) fail(400, "Source is not enabled.");
    const cutoff = new Date(Date.now() - 50 * 60000).toISOString();
    await run(
      db,
      "UPDATE import_runs SET status='failed',finished=?,message='Scan lease expired; safe to retry.' WHERE source_id=? AND status='running' AND started<?",
      now(),
      s.id,
      cutoff,
    );
    const id = uuid(),
      created = await run(
        db,
        "INSERT INTO import_runs (id,source_id,generation,status,started) SELECT ?,?,?,'running',? WHERE NOT EXISTS (SELECT 1 FROM import_runs WHERE source_id=? AND status='running')",
        id,
        s.id,
        s.generation,
        now(),
        s.id,
      );
    if (created.meta?.changes === 0)
      fail(409, "A scan is already in progress.");
    await run(
      db,
      "UPDATE automation_sources SET status='scanning',last_error=NULL,sync_requested=0 WHERE id=?",
      s.id,
    );
    return response({ run_id: id, source: s });
  }
  if (p.endsWith("/resolve")) {
    const r = await activeRun(db, d.run_id);
    if (!fileId(d.folder_id)) fail(400, "Invalid Drive folder ID.");
    const s = await one(
      db,
      "SELECT * FROM automation_sources WHERE id=?",
      r.source_id,
    );
    if (s.folder_id && s.folder_id !== d.folder_id)
      fail(400, "Folder does not match the configured source.");
    if (!s.folder_id && s.folder_input !== d.folder_name)
      fail(400, "Folder name must exactly match the configured name.");
    await run(
      db,
      "UPDATE automation_sources SET folder_id=?,folder_name=? WHERE id=?",
      d.folder_id,
      text(d.folder_name, "Folder name", 300),
      s.id,
    );
    return response({ ok: true });
  }
  if (p.endsWith("/ingest")) {
    const r = await activeRun(db, d.run_id);
    if (!r.folder_id) fail(409, "Resolve the source folder before importing.");
    if (!Array.isArray(d.items) || d.items.length > 50)
      fail(400, "Send at most 50 items per request.");
    const sourceCfg = parseSourceConfig(r.source_config);
    const output = [];
    for (const v of d.items) {
      if (!fileId(v.drive_file_id)) fail(400, "Invalid source file ID.");
      if (
        !Array.isArray(v.ancestor_ids) ||
        !v.ancestor_ids.includes(r.folder_id)
      )
        fail(400, "File must be inside the configured source folder.");
      const name = text(v.name, "Filename", 300),
        path = text(v.source_path, "Source path", 1000),
        mime = text(v.mime, "MIME type", 150),
        revision = text(v.revision, "Revision", 200),
        kind = classifyMaterial(name, path, mime, sourceCfg),
        url = driveUrl(v.url, v.drive_file_id),
        order = lesson(name, path),
        classDate = extractClassDate(v),
        size = Number(v.size || 0);
      if (!Number.isSafeInteger(size) || size < 0)
        fail(400, "Invalid file size.");
      const warning =
        kind === "private"
          ? "Instructor-only, excluded folder/type, draft, or result data. Override category only if confirmed safe for students."
          : kind === "test_link"
            ? "A published student Google Form link is required. Prompts and answer keys must remain private."
            : "Drive links retain their existing sharing permissions. A copied attachment can be opened within the portal after approval.";
      const old = await one(
        db,
        "SELECT id,status,file_id,class_date FROM import_items WHERE source_id=? AND generation=? AND drive_file_id=? AND revision=?",
        r.source_id,
        r.generation,
        v.drive_file_id,
        revision,
      );
      if (old) {
        if (old.status === "restricted" && kind !== "private") {
          await run(
            db,
            "UPDATE import_items SET kind=?, status='pending', warning=? WHERE id=?",
            kind,
            warning,
            old.id,
          );
          output.push({
            ...old,
            status: "pending",
            kind,
            reclassified: true,
          });
          continue;
        }
        output.push({ ...old, duplicate: true });
        continue;
      }
      const id = uuid();
      await run(
        db,
        "INSERT OR IGNORE INTO import_items (id,source_id,generation,drive_file_id,revision,title,kind,topic,topic_order,source_path,source_url,mime,size,status,warning,class_date,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        r.source_id,
        r.generation,
        v.drive_file_id,
        revision,
        name.replace(/\.[^.]+$/, ""),
        kind,
        order === 1 && !/day|lesson|topic|module/i.test(`${path}/${name}`)
          ? "Needs topic review"
          : `Day ${order}`,
        Math.min(100, Math.max(1, order)),
        path,
        url,
        mime,
        size,
        kind === "private" ? "restricted" : "pending",
        warning,
        classDate,
        now(),
      );
      const saved = await one(
        db,
        "SELECT id,status,file_id,class_date FROM import_items WHERE source_id=? AND generation=? AND drive_file_id=? AND revision=?",
        r.source_id,
        r.generation,
        v.drive_file_id,
        revision,
      );
      output.push(saved);
    }
    return response({ items: output });
  }
  if (p.endsWith("/finish")) {
    const r = await activeRun(db, d.run_id);
    const status =
        d.status === "succeeded"
          ? "succeeded"
          : d.status === "partial"
            ? "partial"
            : "failed",
      message = String(d.message || "").slice(0, 3000);
    await db.batch([
      db
        .prepare(
          "UPDATE import_runs SET status=?,finished=?,message=?,discovered=? WHERE id=?",
        )
        .bind(
          status,
          now(),
          message,
          Number.isInteger(d.discovered) ? Math.max(0, d.discovered) : 0,
          r.id,
        ),
      db
        .prepare(
          "UPDATE automation_sources SET status=?,last_sync=?,last_error=? WHERE id=? AND generation=?",
        )
        .bind(
          status === "succeeded" ? "ready" : status,
          now(),
          status === "succeeded" ? null : message,
          r.source_id,
          r.generation,
        ),
    ]);
    return response({ ok: true });
  }
  fail(404, "Automation endpoint not found.");
}
