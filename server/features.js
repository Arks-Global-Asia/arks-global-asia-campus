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
  staff,
  isStaff,
  https,
  istDateInfo,
} from "./common.js";
import { setAdminPassword } from "./auth.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const ELIGIBLE_LEARNING_KINDS = [
  "notes",
  "slides",
  "guide",
  "recording",
  "lab",
  "image",
];

export const COMPREHENSIVE_QUESTION_TYPES = [
  "mcq",
  "multi_select",
  "true_false",
  "fill_blank",
  "short_answer",
  "scenario",
  "code",
  "matching",
  "ordering",
];

const VERIFIED_DOC_FALLBACKS = [
  { match: /k8s|kubernetes|kubectl|pod|deployment|helm/i, url: "https://kubernetes.io/docs/home/", title: "Kubernetes Official Documentation" },
  { match: /docker|container|dockerfile|compose/i, url: "https://docs.docker.com/", title: "Docker Official Documentation" },
  { match: /azure|aks|arm|bicep|devops/i, url: "https://learn.microsoft.com/en-us/azure/", title: "Microsoft Azure Official Documentation" },
  { match: /terraform|hcl|iac/i, url: "https://developer.hashicorp.com/terraform/docs", title: "Terraform Official Documentation" },
  { match: /git|branch|rebase|commit|merge/i, url: "https://git-scm.com/doc", title: "Git Official Reference Documentation" },
  { match: /github|actions|workflow|ci\/cd/i, url: "https://docs.github.com/en/actions", title: "GitHub Actions Official Documentation" },
  { match: /ansible|playbook/i, url: "https://docs.ansible.com/", title: "Ansible Official Documentation" },
  { match: /linux|bash|shell|chmod|systemd/i, url: "https://man7.org/linux/man-pages/", title: "Linux Manual Pages & Shell Reference" },
];

export function calculateAssessmentSpec(resources = [], kind = "daily") {
  const countResources = Math.max(1, resources.length);
  const totalChars = resources.reduce(
    (sum, r) => sum + String(r.title || "").length + String(r.body || "").length,
    0,
  );
  const isWeekly = kind === "weekly";
  const minCount = isWeekly ? 25 : 20;
  const maxCount = isWeekly ? 50 : 40;
  const base = isWeekly ? 20 : 16;
  const perResource = isWeekly ? 3 : 4;
  const depthBonus = Math.floor(totalChars / 2500);
  const count = Math.max(
    minCount,
    Math.min(maxCount, base + countResources * perResource + depthBonus),
  );
  const duration = isWeekly
    ? Math.max(45, Math.min(120, Math.round(count * 1.5)))
    : Math.max(30, Math.min(90, Math.round(count * 1.5)));
  return {
    count,
    duration,
    question_types: [...COMPREHENSIVE_QUESTION_TYPES],
  };
}

export function sanitizeSummary(raw, questions = [], feedback = []) {
  const input = raw && typeof raw === "object" ? raw : {};
  let strengths = Array.isArray(input.strengths)
    ? input.strengths
        .map((s) => String(s || "").trim().slice(0, 400))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  let improvements = Array.isArray(input.improvements)
    ? input.improvements
        .map((s) => String(s || "").trim().slice(0, 400))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  let recommendations = Array.isArray(input.recommendations)
    ? input.recommendations
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const title = String(r.title || "").trim().slice(0, 200);
          if (!title) return null;
          const category = ["official_doc", "notes", "video"].includes(
            r.category,
          )
            ? r.category
            : "official_doc";
          let safeUrl = "";
          if (r.url && typeof r.url === "string") {
            try {
              const u = new URL(r.url.trim());
              if (u.protocol === "https:") safeUrl = u.href;
            } catch {}
          }
          if (category === "official_doc" && !safeUrl) {
            const matched = VERIFIED_DOC_FALLBACKS.find((f) =>
              f.match.test(title + " " + (r.description || "")),
            );
            safeUrl = matched ? matched.url : "https://kubernetes.io/docs/home/";
          }
          return {
            title,
            category,
            url: safeUrl,
            description: String(r.description || "").trim().slice(0, 500),
          };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  // Fallback synthesis if AI worker did not supply summary fields
  if (!strengths.length && questions.length && feedback.length) {
    const strongQs = questions.filter(
      (q, i) => (feedback[i]?.marks ?? 0) >= (q.marks || 1) * 0.7,
    );
    if (strongQs.length) {
      strengths = strongQs
        .slice(0, 3)
        .map((q) => `Solid understanding demonstrated on: ${String(q.prompt || "").slice(0, 120)}`);
    } else {
      strengths = ["Completed assessment attempt; review foundational concepts below."];
    }
  }
  if (!improvements.length && questions.length && feedback.length) {
    const weakQs = questions.filter(
      (q, i) => (feedback[i]?.marks ?? 0) < (q.marks || 1) * 0.7,
    );
    if (weakQs.length) {
      improvements = weakQs
        .slice(0, 3)
        .map((q) => `Review concept & syntax for: ${String(q.prompt || "").slice(0, 120)}`);
    } else {
      improvements = ["Strong performance across all evaluated topics. Continue practicing advanced YAML/CLI scenarios."];
    }
  }
  if (!recommendations.length && questions.length) {
    const allPrompts = questions.map((q) => q.prompt || "").join(" ");
    const matchedDocs = VERIFIED_DOC_FALLBACKS.filter((f) =>
      f.match.test(allPrompts),
    ).slice(0, 2);
    for (const doc of matchedDocs.length ? matchedDocs : [VERIFIED_DOC_FALLBACKS[0]]) {
      recommendations.push({
        title: doc.title,
        category: "official_doc",
        url: doc.url,
        description: "Review official reference guides and configuration specifications.",
      });
    }
    recommendations.push({
      title: "Batch Class Notes, Resource Creation Guides & Recordings",
      category: "notes",
      url: "",
      description: "Revisit your approved class notes and live session recordings in the Learning Library.",
    });
  }

  return { strengths, improvements, recommendations };
}

export async function wakeEngine(env, source_id = null) {
  if (!env.AZURE_ENGINE_URL || !env.AZURE_ENGINE_KEY) return false;
  const u = new URL(env.AZURE_ENGINE_URL);
  if (u.protocol !== "https:" || !u.hostname.endsWith(".azurewebsites.net"))
    fail(503, "Invalid Azure engine configuration.");
  let r;
  try {
    r = await fetch(u, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-functions-key": env.AZURE_ENGINE_KEY,
      },
      body: JSON.stringify({ source_id }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    fail(
      503,
      "Azure engine could not be reached. The saved job can be retried.",
    );
  }
  if (!r.ok) {
    let snippet = "";
    try {
      const raw = await r.text();
      snippet = raw
        .replace(/[\r\n\t]+/g, " ")
        .replace(/(?:authorization|x-functions-key|x-arks-importer-token|cookie|set-cookie)\s*:\s*\S+/gi, "[redacted]")
        .trim()
        .slice(0, 200);
    } catch {}
    fail(
      503,
      `Azure rejected dispatch (HTTP ${r.status})${snippet ? `: ${snippet}` : ". Try again or check the engine."}`,
    );
  }
  return true;
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

export async function scheduleAssessmentsForCampus(db, env, options = {}) {
  const info = istDateInfo(options.reference_date || new Date());
  const isSunday = info.dayOfWeek === 0;
  const mode = options.mode || (isSunday ? "weekly" : "daily");

  // Hard rule: Never run a Daily Test on Sunday unless explicitly forced by mode='daily' on a non-Sunday
  if (isSunday && mode === "daily" && !options.force_daily_on_sunday) {
    return {
      mode: "skipped_sunday_daily",
      ist_date: info.dateKey,
      results: [],
      message: "Daily tests do not run on Sundays. Sunday 9:00 AM IST runs the Weekly Test.",
    };
  }

  const activeBatches = options.batch_id
    ? await rows(
        db,
        "SELECT * FROM batches WHERE id=? AND status='active'",
        options.batch_id,
      )
    : await rows(db, "SELECT * FROM batches WHERE status='active'");

  const results = [];
  let queuedAny = false;

  for (const b of activeBatches) {
    if (!options.batch_id) {
      const srcRow = await one(
        db,
        "SELECT config FROM automation_sources WHERE batch_id=?",
        b.id,
      );
      if (srcRow?.config) {
        try {
          if (JSON.parse(srcRow.config).auto_daily_test === false) {
            results.push({
              batch_id: b.id,
              batch_name: b.name,
              kind: mode,
              status: "skipped",
              reason: "auto_schedule_disabled",
            });
            continue;
          }
        } catch {}
      }
    }
    if (mode === "weekly") {
      const entityId = `weekly-${b.id}-${info.weekMondayKey}`;
      const existingTest = await one(
        db,
        "SELECT id FROM tests WHERE id=?",
        entityId,
      );
      if (existingTest) {
        results.push({
          batch_id: b.id,
          batch_name: b.name,
          kind: "weekly",
          status: "skipped",
          reason: "already_generated",
          test_id: entityId,
        });
        continue;
      }

      // Find all approved learning materials published Monday 00:00 IST through Saturday 23:59:59 IST of this week
      const weekMaterials = await rows(
        db,
        `SELECT c.* FROM content c
         LEFT JOIN import_items i ON i.content_id = c.id AND i.status = 'published'
         WHERE c.course_id = ?
           AND (c.batch_id = ? OR c.batch_id IS NULL)
           AND c.published = 1
           AND c.kind IN ('notes','slides','guide','lab','recording','image')
           AND (
             (i.class_date >= ? AND i.class_date <= ?)
             OR (c.created >= ? AND c.created <= ?)
           )
         ORDER BY c.topic_order ASC, c.created ASC`,
        b.course_id,
        b.id,
        info.weekMondayKey,
        info.weekSaturdayKey,
        info.mondayStartUtc,
        info.saturdayEndUtc,
      );

      const uniqueMaterials = [
        ...new Map(weekMaterials.map((m) => [m.id, m])).values(),
      ].slice(0, 30);

      if (!uniqueMaterials.length) {
        results.push({
          batch_id: b.id,
          batch_name: b.name,
          kind: "weekly",
          status: "skipped",
          reason: "no_classes_this_week",
        });
        continue;
      }

      const spec = calculateAssessmentSpec(uniqueMaterials, "weekly");
      const maxTopicOrder = Math.max(
        1,
        ...uniqueMaterials.map((c) => Number(c.topic_order) || 1),
      );
      const jobId = await queueJob(db, "generate_test", b.id, entityId, {
        title: `Weekly Assessment (${info.weekMondayKey} to ${info.weekSaturdayKey})`,
        kind: "weekly",
        count: Number(options.count) >= 25 ? Number(options.count) : spec.count,
        question_types: spec.question_types,
        duration: spec.duration,
        course_id: b.course_id,
        topic_order: Math.min(b.covered || maxTopicOrder, maxTopicOrder),
        source_ids: uniqueMaterials.map((c) => c.id),
        auto_publish: options.auto_publish !== false,
      });
      queuedAny = true;
      results.push({
        batch_id: b.id,
        batch_name: b.name,
        kind: "weekly",
        status: "queued",
        job_id: jobId,
        test_id: entityId,
        count: Number(options.count) >= 25 ? Number(options.count) : spec.count,
        source_count: uniqueMaterials.length,
      });
    } else {
      // Monday-Saturday 9:00 AM IST Daily Assessment covering previous day's class materials
      const targetClassDate = options.class_date || info.prevDateKey;
      const entityId = `daily-${b.id}-${targetClassDate}`;
      const existingTest = await one(
        db,
        "SELECT id FROM tests WHERE id=?",
        entityId,
      );
      if (existingTest) {
        results.push({
          batch_id: b.id,
          batch_name: b.name,
          kind: "daily",
          status: "skipped",
          reason: "already_generated",
          test_id: entityId,
        });
        continue;
      }

      // Compute UTC window for targetClassDate (00:00:00 IST of targetClassDate through 09:00:00 IST next day)
      const [y, m, d] = targetClassDate.split("-").map(Number);
      const windowStartUtc = new Date(
        Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 330 * 60 * 1000,
      ).toISOString();
      const windowEndUtc = new Date(
        Date.UTC(y, m - 1, d + 1, 9, 0, 0, 0) - 330 * 60 * 1000,
      ).toISOString();

      const dayMaterials = await rows(
        db,
        `SELECT c.* FROM content c
         LEFT JOIN import_items i ON i.content_id = c.id AND i.status = 'published'
         WHERE c.course_id = ?
           AND (c.batch_id = ? OR c.batch_id IS NULL)
           AND c.published = 1
           AND c.kind IN ('notes','slides','guide','lab','recording','image')
           AND (
             i.class_date = ?
             OR (c.created >= ? AND c.created <= ?)
           )
         ORDER BY c.topic_order ASC, c.created ASC`,
        b.course_id,
        b.id,
        targetClassDate,
        windowStartUtc,
        windowEndUtc,
      );

      const uniqueMaterials = [
        ...new Map(dayMaterials.map((item) => [item.id, item])).values(),
      ].slice(0, 30);

      if (!uniqueMaterials.length) {
        results.push({
          batch_id: b.id,
          batch_name: b.name,
          kind: "daily",
          status: "skipped",
          reason: "no_class_materials",
          class_date: targetClassDate,
        });
        continue;
      }

      const spec = calculateAssessmentSpec(uniqueMaterials, "daily");
      const maxTopicOrder = Math.max(
        1,
        ...uniqueMaterials.map((c) => Number(c.topic_order) || 1),
      );
      const jobId = await queueJob(db, "generate_test", b.id, entityId, {
        title: `Daily Assessment — ${targetClassDate}`,
        kind: "daily",
        count: Number(options.count) >= 20 ? Number(options.count) : spec.count,
        question_types: spec.question_types,
        duration: spec.duration,
        course_id: b.course_id,
        topic_order: Math.min(b.covered || maxTopicOrder, maxTopicOrder),
        source_ids: uniqueMaterials.map((c) => c.id),
        auto_publish: options.auto_publish !== false,
      });
      queuedAny = true;
      results.push({
        batch_id: b.id,
        batch_name: b.name,
        kind: "daily",
        status: "queued",
        job_id: jobId,
        test_id: entityId,
        class_date: targetClassDate,
        count: Number(options.count) >= 20 ? Number(options.count) : spec.count,
        source_count: uniqueMaterials.length,
      });
    }
  }

  if (queuedAny && env.AZURE_ENGINE_URL) {
    try {
      await wakeEngine(env);
    } catch {}
  }

  return {
    mode,
    ist_date: info.dateKey,
    results,
  };
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
  };
}

export async function featureRoutes(req, env, u) {
  const db = env.DB,
    p = new URL(req.url).pathname;
  if (p === "/api/admin/features" && req.method === "GET") {
    staff(u);
    return json({
      groups: await rows(db, "SELECT * FROM access_groups"),
      members: await rows(db, "SELECT * FROM group_members"),
      jobs: await rows(
        db,
        "SELECT id,kind,batch_id,entity_id,status,error,created,finished FROM engine_jobs ORDER BY created DESC LIMIT 100",
      ),
      drive_sops: await rows(
        db,
        "SELECT i.id,i.title,i.kind,i.status,i.file_id,i.source_url,s.batch_id FROM import_items i JOIN automation_sources s ON s.id=i.source_id WHERE i.status IN ('pending','published') AND (i.kind='sop' OR lower(i.title) LIKE '%sop%' OR lower(i.title) LIKE '%syllabus%' OR lower(i.title) LIKE '%roadmap%' OR lower(i.title) LIKE '%curriculum%') ORDER BY i.created DESC LIMIT 50",
      ),
      engine_ready: !!(env.AZURE_ENGINE_URL && env.AZURE_ENGINE_KEY),
      google_ready: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      auth_mode: env.AUTH_MODE || "google",
    });
  }
  if (p === "/api/admin/password" && req.method === "POST")
    return setAdminPassword(db, u, await req.json());
  if (p === "/api/admin/batch-config" && req.method === "POST") {
    staff(u);
    const d = await req.json();
    await member(db, u, d.batch_id);
    if (d.covered !== undefined) {
      const cov = Math.max(0, Math.min(100, Math.floor(Number(d.covered) || 0)));
      await run(
        db,
        "UPDATE batches SET config=?, covered=? WHERE id=?",
        JSON.stringify(safeConfig(d)),
        cov,
        d.batch_id,
      );
    } else {
      await run(
        db,
        "UPDATE batches SET config=? WHERE id=?",
        JSON.stringify(safeConfig(d)),
        d.batch_id,
      );
    }
    return json({ ok: true });
  }
  if (p === "/api/admin/users" && req.method === "POST") {
    staff(u);
    const d = await req.json();
    const email = String(d.email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "Enter a valid email address.");
    const name = String(d.name || "").trim();
    if (!name || name.length > 100)
      fail(400, "Full name is required (maximum 100 characters).");
    const phone = String(d.phone || "")
      .trim()
      .slice(0, 30);
    const role = d.role === undefined || d.role === "" ? "student" : String(d.role);
    if (!["student", "trainer", "admin"].includes(role))
      fail(400, "Role must be student, trainer, or admin.");
    if (role !== "student") admin(u);
    const password =
      d.password !== undefined && d.password !== null
        ? String(d.password)
        : "";
    if (role !== "student" && password) {
      if (password.length < 14 || password.length > 256)
        fail(400, "Use a password of 14–256 characters.");
    }
    const existing = await one(
      db,
      "SELECT id FROM users WHERE lower(email)=?",
      email,
    );
    if (existing) fail(409, "A user with this email already exists.");
    const userId = uid();
    await run(
      db,
      "INSERT INTO users (id,email,name,role,phone,goal,active,onboarded,created) VALUES (?,?,?,?,?,?,1,0,?)",
      userId,
      email,
      name,
      role,
      phone,
      "",
      now(),
    );
    if (role !== "student" && password) {
      await setAdminPassword(db, u, { email, name, role, password });
    }
    await run(
      db,
      "INSERT INTO audit (id,actor,action,entity,created) VALUES (?,?,?,?,?)",
      uid(),
      u.id,
      "create:user",
      userId,
      now(),
    );
    return json({ ok: true, id: userId, role });
  }
  if (p === "/api/admin/group-members" && req.method === "POST") {
    staff(u);
    const d = await req.json();
    const action = d.action === "add" || d.action === "remove" ? d.action : null;
    if (!action) fail(400, "Action must be add or remove.");
    const g = await one(
      db,
      "SELECT * FROM access_groups WHERE id=?",
      String(d.group_id || ""),
    );
    if (!g) fail(404, "Batch group not found.");
    await member(db, u, g.batch_id);
    const emailSet = new Set();
    if (Array.isArray(d.user_ids)) {
      for (const targetUid of d.user_ids) {
        if (typeof targetUid !== "string" || !targetUid.trim()) continue;
        const person = await one(
          db,
          "SELECT email FROM users WHERE id=?",
          targetUid.trim(),
        );
        if (person?.email) emailSet.add(String(person.email).trim().toLowerCase());
      }
    }
    if (Array.isArray(d.emails)) {
      for (const rawEmail of d.emails) {
        const cleaned = String(rawEmail || "")
          .trim()
          .toLowerCase();
        if (!cleaned) continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))
          fail(400, `Invalid email address: ${cleaned}`);
        emailSet.add(cleaned);
      }
    }
    if (action === "add" && Array.isArray(d.new_students)) {
      if (d.new_students.length > 500)
        fail(400, "Up to 500 new students can be added at once.");
      for (const entry of d.new_students) {
        const cleaned = String(entry?.email || "")
          .trim()
          .toLowerCase();
        if (!cleaned) continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))
          fail(400, `Invalid email address: ${cleaned}`);
        const existing = await one(
          db,
          "SELECT id FROM users WHERE lower(email)=?",
          cleaned,
        );
        if (!existing) {
          const name =
            String(entry?.name || "")
              .trim()
              .slice(0, 120) || cleaned.split("@")[0];
          const phone = String(entry?.phone || "")
            .trim()
            .slice(0, 30);
          await run(
            db,
            "INSERT INTO users (id,email,name,role,phone,goal,active,onboarded,created) VALUES (?,?,?,'student',?,'',1,0,?)",
            uid(),
            cleaned,
            name,
            phone,
            now(),
          );
        }
        emailSet.add(cleaned);
      }
    }
    const resolvedEmails = [...emailSet];
    if (!resolvedEmails.length || resolvedEmails.length > 2000)
      fail(400, "Select at least one valid user or email address.");
    if (resolvedEmails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
      fail(400, "Enter valid member email addresses.");
    if (action === "add") {
      let fee = 0;
      if (d.fee !== undefined && d.fee !== null && d.fee !== "") {
        fee = Math.max(0, Math.floor(Number(d.fee) || 0));
      } else {
        const courseRow = await one(
          db,
          "SELECT c.fee FROM courses c JOIN batches b ON b.course_id=c.id WHERE b.id=?",
          g.batch_id,
        );
        fee = Math.max(0, Number(courseRow?.fee) || 0);
      }
      for (const email of resolvedEmails) {
        await run(
          db,
          "INSERT OR IGNORE INTO group_members (group_id,email) VALUES (?,?)",
          g.id,
          email,
        );
        const person = await one(
          db,
          "SELECT id FROM users WHERE lower(email)=?",
          email,
        );
        if (person) {
          await run(
            db,
            "INSERT OR IGNORE INTO enrollments (id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
            uid(),
            person.id,
            g.batch_id,
            fee,
            now(),
          );
        }
        await run(
          db,
          "INSERT OR IGNORE INTO invitations (id,email,batch_id,role,fee) VALUES (?,?,?,'student',?)",
          uid(),
          email,
          g.batch_id,
          fee,
        );
      }
      if (g.google_group) {
        await queueJob(db, "google_group_update", g.batch_id, g.id, {
          google_group: g.google_group,
          add: resolvedEmails,
          remove: [],
        });
        if (env.AZURE_ENGINE_URL) {
          try {
            await wakeEngine(env);
          } catch {}
        }
      }
    } else {
      for (const email of resolvedEmails) {
        await run(
          db,
          "DELETE FROM group_members WHERE group_id=? AND lower(email)=?",
          g.id,
          email,
        );
      }
      if (g.google_group) {
        await queueJob(db, "google_group_update", g.batch_id, g.id, {
          google_group: g.google_group,
          add: [],
          remove: resolvedEmails,
        });
        if (env.AZURE_ENGINE_URL) {
          try {
            await wakeEngine(env);
          } catch {}
        }
      }
    }
    await run(
      db,
      "INSERT INTO audit (id,actor,action,entity,created) VALUES (?,?,?,?,?)",
      uid(),
      u.id,
      `group_members:${action}`,
      g.id,
      now(),
    );
    return json({ ok: true, count: resolvedEmails.length });
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
    staff(u);
    const d = await req.json();
    await member(db, u, d.batch_id);
    if (!d.name?.trim()) fail(400, "Group name is required.");
    const group = d.id || uid();
    const emailSet = new Set(
      String(d.members || "")
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
    if (Array.isArray(d.user_ids)) {
      for (const targetUid of d.user_ids) {
        if (typeof targetUid !== "string" || !targetUid.trim()) continue;
        const person = await one(
          db,
          "SELECT email FROM users WHERE id=?",
          targetUid.trim(),
        );
        if (person?.email) emailSet.add(String(person.email).trim().toLowerCase());
      }
    }
    if (Array.isArray(d.new_students)) {
      if (d.new_students.length > 500)
        fail(400, "Up to 500 new students can be added at once.");
      for (const entry of d.new_students) {
        const cleaned = String(entry?.email || "")
          .trim()
          .toLowerCase();
        if (!cleaned) continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))
          fail(400, `Invalid email address: ${cleaned}`);
        const existing = await one(
          db,
          "SELECT id FROM users WHERE lower(email)=?",
          cleaned,
        );
        if (!existing) {
          const name =
            String(entry?.name || "")
              .trim()
              .slice(0, 120) || cleaned.split("@")[0];
          const phone = String(entry?.phone || "")
            .trim()
            .slice(0, 30);
          await run(
            db,
            "INSERT INTO users (id,email,name,role,phone,goal,active,onboarded,created) VALUES (?,?,?,'student',?,'',1,0,?)",
            uid(),
            cleaned,
            name,
            phone,
            now(),
          );
        }
        emailSet.add(cleaned);
      }
    }
    const emails = [...emailSet];
    if (
      emails.length > 2000 ||
      emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    )
      fail(400, "Enter valid member email addresses.");
    let fee = 0;
    if (d.fee !== undefined && d.fee !== null && d.fee !== "") {
      fee = Math.max(0, Math.floor(Number(d.fee) || 0));
    } else {
      const courseRow = await one(
        db,
        "SELECT c.fee FROM courses c JOIN batches b ON b.course_id=c.id WHERE b.id=?",
        d.batch_id,
      );
      fee = Math.max(0, Number(courseRow?.fee) || 0);
    }
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
        "INSERT INTO access_groups (id,name,google_group,batch_id) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,google_group=excluded.google_group",
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
      for (const email of emails) {
        const person = await one(
          db,
          "SELECT id FROM users WHERE lower(email)=?",
          email,
        );
        if (person) {
          await run(
            db,
            "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
            uid(),
            person.id,
            d.batch_id,
            fee,
            now(),
          );
        }
        await run(
          db,
          "INSERT OR IGNORE INTO invitations (id,email,batch_id,role,fee) VALUES (?,?,?,'student',?)",
          uid(),
          email,
          d.batch_id,
          fee,
        );
      }
      await queueJob(db, "google_group_update", d.batch_id, group, {
        google_group: remote,
        add: emails.filter((e) => !previous.some((p) => p.email === e)),
        remove: previous.map((p) => p.email).filter((e) => !emails.includes(e)),
      });
      const dispatched = await wakeEngine(env);
      return json({
        id: group,
        ok: true,
        message: dispatched
          ? "Google Group update queued; access changes after verified sync."
          : "Group update queued. Configure the Azure engine and Workspace delegation to apply it.",
      });
    }
    await db.batch([
      db
        .prepare(
          "INSERT INTO access_groups (id,name,google_group,batch_id) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,google_group=excluded.google_group",
        )
        .bind(
          group,
          d.name.trim().slice(0, 200),
          String(d.google_group || "").slice(0, 200),
          d.batch_id,
        ),
      db.prepare("DELETE FROM group_members WHERE group_id=?").bind(group),
      ...emails.map((email) =>
        db.prepare("INSERT INTO group_members (group_id,email) VALUES (?,?)").bind(group, email),
      ),
    ]);
    for (const email of emails) {
      const person = await one(
        db,
        "SELECT id FROM users WHERE lower(email)=?",
        email,
      );
      if (person)
        await run(
          db,
          "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
          uid(),
          person.id,
          d.batch_id,
          fee,
          now(),
        );
      await run(
        db,
        "INSERT OR IGNORE INTO invitations (id,email,batch_id,role,fee) VALUES (?,?,?,'student',?)",
        uid(),
        email,
        d.batch_id,
        fee,
      );
    }
    return json({ id: group, ok: true, count: emails.length });
  }
  if (p === "/api/admin/sessions" && req.method === "POST") {
    staff(u);
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
    staff(u);
    if (!env.AZURE_ENGINE_URL)
      fail(503, "Configure the Azure engine before generating assessments.");
    const d = await req.json(),
      b = await member(db, u, d.batch_id);
    if (!["daily", "weekly", "monthly"].includes(d.kind))
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
      if (!c || !ELIGIBLE_LEARNING_KINDS.includes(c.kind))
        fail(400, "Only approved learning materials are eligible.");
      selected.push(c);
    }
    const spec = calculateAssessmentSpec(selected, d.kind);
    const count = d.count !== undefined ? Number(d.count) : spec.count;
    if (!Number.isInteger(count) || count < 1 || count > 100)
      fail(400, "Choose 1–100 questions.");
    const types = [
      ...new Set(
        d.question_types?.length ? d.question_types : spec.question_types,
      ),
    ];
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
      duration: Math.max(1, Math.min(180, Number(d.duration) || spec.duration)),
      course_id: b.course_id,
      topic_order: Math.max(...selected.map((c) => c.topic_order)),
      source_ids: ids,
      auto_publish: Boolean(d.auto_publish),
    });
    await wakeEngine(env);
    return json({
      id,
      message: "Generation queued. Review the draft before publishing.",
    });
  }
  if (p === "/api/admin/trigger-scheduled-tests" && req.method === "POST") {
    staff(u);
    const d = await req.json();
    const outcome = await scheduleAssessmentsForCampus(db, env, d);
    return json(outcome);
  }
  if (p === "/api/admin/extract-sop" && req.method === "POST") {
    staff(u);
    const d = await req.json(),
      b = await member(db, u, d.batch_id);
    const c = await one(
      db,
      "SELECT * FROM content WHERE id=? AND kind IN ('sop','guide','notes') AND published=1 AND course_id=? AND (batch_id=? OR batch_id IS NULL)",
      d.content_id,
      b.course_id,
      b.id,
    );
    if (!c) fail(400, "Choose an approved SOP, guide, or notes resource for this batch.");
    const id = await queueJob(db, "extract_sop", b.id, c.id, {
      content_id: c.id,
    });
    const dispatched = await wakeEngine(env);
    return json({ id, dispatched });
  }
  if (p === "/api/admin/apply-roadmap" && req.method === "POST") {
    staff(u);
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
    staff(u);
    return json(
      await one(
        db,
        "SELECT id,status,result,error FROM engine_jobs WHERE id=?",
        new URL(req.url).searchParams.get("id"),
      ),
    );
  }
  if (p === "/api/admin/retry-job" && req.method === "POST") {
    staff(u);
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
    if (!a || !a.submitted || (!isStaff(u) && a.user_id !== u.id))
      fail(404, "Result not found.");
    return resultPdf(a);
  }
  return null;
}

export async function engineRoutes(req, env) {
  const db = env.DB,
    p = new URL(req.url).pathname;
  if (p === "/api/automation/schedule-assessments" && req.method === "POST") {
    let body = {};
    try {
      body = await req.json();
    } catch {}
    return json(await scheduleAssessmentsForCampus(db, env, body));
  }
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
        db.prepare("INSERT INTO group_members (group_id,email) VALUES (?,?)").bind(g.id, e),
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
      payload.folder_id = JSON.parse(b.config || "{}").submission_folder;
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
    const qs = normalizeQuestions(result.questions);
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
    const publishFlag = payload.auto_publish ? 1 : 0;
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
      publishFlag,
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
    const diagnosticSummary = sanitizeSummary(result.summary, qs, feedback);
    await run(
      db,
      "UPDATE attempts SET feedback=?,summary=?,score=?,grading_status='complete' WHERE id=?",
      JSON.stringify(feedback),
      JSON.stringify(diagnosticSummary),
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
    page.drawText("LEARNING CAMPUS  |  Diagnostic Assessment Report", {
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

  let summary = {};
  try {
    summary = JSON.parse(a.summary || "{}");
  } catch {}
  if (Array.isArray(summary.strengths) && summary.strengths.length) {
    y -= 8;
    text("Key Strengths", true);
    for (const item of summary.strengths) {
      text("- " + item);
    }
  }
  if (Array.isArray(summary.improvements) && summary.improvements.length) {
    y -= 8;
    text("Areas for Improvement", true);
    for (const item of summary.improvements) {
      text("- " + item);
    }
  }
  if (
    Array.isArray(summary.recommendations) &&
    summary.recommendations.length
  ) {
    y -= 8;
    text("Recommended Documentation, Notes & Learning Resources", true);
    for (const rec of summary.recommendations) {
      const label = rec.url ? `${rec.title} (${rec.url})` : rec.title;
      text("- " + label + (rec.description ? ": " + rec.description : ""));
    }
  }

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
    if (q.explanation) text("Explanation: " + q.explanation);
    if (feedback[i]) text("Feedback: " + feedbackText(feedback[i]));
  });
  return new Response(await doc.save(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="arks-result-${a.id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
