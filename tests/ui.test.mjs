import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { api } from "../server/api.js";
import { database, memoryBucket } from "../scripts/database.mjs";
test("student and administrator DOM workflows render and assessment interaction saves results", async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: "https://campus.test",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    LOCAL_DEV_OWNER: "true",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set("oai-authenticated-user-id", "owner");
    headers.set("oai-authenticated-user-email", "owner@arks.test");
    headers.set("oai-authenticated-user-full-name", "Campus Owner");
    return api(
      new Request(new URL(path, "https://campus.test"), {
        ...options,
        headers,
      }),
      env,
    );
  };
  await fs.mkdir(".local", { recursive: true });
  await build({
    entryPoints: ["src/main.jsx"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: ".local/ui-test.mjs",
    packages: "external",
    loader: { ".css": "empty" },
  });
  const { act } = await import("react");
  async function settle(fn = () => {}) {
    await act(async () => {
      await fn();
      await new Promise((r) => setTimeout(r, 35));
    });
  }
  try {
    await settle(() => import("../.local/ui-test.mjs?test=" + Date.now()));
    assert.match(document.body.textContent, /Your next chapter starts here/);
    await settle(() =>
      document.querySelector('[aria-label="Close dialog"]').click(),
    );
    const button = (s) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === s,
      );
    await settle(() => button("Skip").click());
    await settle(() => button("Switch to student view").click());
    await settle(() => button("Skip").click());
    assert.match(document.body.textContent, /Welcome back, Campus/);
    await settle(() => button("Admin portal").click());
    assert.match(document.body.textContent, /Make room for what’s next/);
    // Verify all 6 Admin/Trainer Workspaces render in the sidebar
    for (const wsLabel of [
      "Overview",
      "Curriculum & Batches",
      "Classroom & Content",
      "Assessments & Labs",
      "Students & Team",
      "Queries & Activity",
    ]) {
      assert.ok(
        [...document.querySelectorAll("nav button")].some((b) =>
          b.textContent.includes(wsLabel),
        ),
        `Expected 6-workspace sidebar to include ${wsLabel}`,
      );
    }
    assert.equal(
      document.querySelector(".admin-tabs"),
      null,
      "Overview workspace should not render a redundant sub-tab bar",
    );
    await settle(() => button("Classroom & Content").click());
    assert.match(document.body.textContent, /Let the materials come to you/);
    await settle(() => button("Connect a batch folder").click());
    assert.ok(
      document.querySelector('input[placeholder="DevOps - Batch 01-11-26"]'),
    );
    await settle(() =>
      document.querySelector('[aria-label="Close dialog"]').click(),
    );
    await settle(() => button("Curriculum & Batches").click());
    assert.match(document.body.textContent, /Manage your batches/);
    await settle(() => button("Create batch").click());
    assert.ok(document.querySelector('input[type="date"]'));
    await settle(() =>
      document.querySelector('[aria-label="Close dialog"]').click(),
    );
    await settle(() => button("Switch to student view").click());
    await settle(() =>
      [...document.querySelectorAll("nav button")]
        .find((b) => b.textContent.startsWith("Assessments"))
        .click(),
    );
    assert.match(document.body.textContent, /Small checks/);
    await settle(() => button("Start test").click());
    assert.match(document.body.textContent, /Question 1 of 3/);
    assert.ok(
      document.querySelector('[aria-label="Question navigator palette"]'),
    );
    for (let i = 0; i < 3; i++) {
      await settle(() =>
        document.querySelectorAll(".quiz-options button")[i].click(),
      );
      await settle(() =>
        button(i === 2 ? "Submit assessment" : "Next question").click(),
      );
    }
    assert.match(document.body.textContent, /100 \/ 100 marks/);
    assert.match(document.body.textContent, /KEY STRENGTHS/);
    assert.match(document.body.textContent, /AREAS FOR IMPROVEMENT/);
    assert.match(
      document.body.textContent,
      /RECOMMENDED OFFICIAL DOCS, NOTES & VIDEO REFERENCES/,
    );
    assert.equal(
      (
        await env.DB.prepare(
          "SELECT score FROM attempts WHERE submitted IS NOT NULL",
        ).first()
      ).score,
      100,
    );
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("repository hygiene removes legacy OpenAI hosting clutter and includes Azure Static Web Apps config", async () => {
  for (const removedPath of [
    ".openai",
    "HANDOVER.json",
    "SOURCE-MANIFEST.json",
    "azure/pricing-2026-11-17.json",
    "public/docs",
  ]) {
    let exists = true;
    try {
      await fs.access(removedPath);
    } catch {
      exists = false;
    }
    assert.equal(
      exists,
      false,
      `Expected obsolete path ${removedPath} to be deleted`,
    );
  }
  const swaRaw = await fs.readFile("public/staticwebapp.config.json", "utf8");
  const swaConfig = JSON.parse(swaRaw);
  assert.equal(swaConfig.navigationFallback.rewrite, "/index.html");
  assert.equal(swaConfig.globalHeaders["X-Content-Type-Options"], "nosniff");
  assert.match(
    swaConfig.globalHeaders["Content-Security-Policy"] || "",
    /frame-src 'self'/,
  );
});

test("content inbox file-type filters, bulk select/approve/reject, and student inline image/PDF reader work in DOM", async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: "https://campus.test",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    LOCAL_DEV_OWNER: "true",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set("oai-authenticated-user-id", "owner");
    headers.set("oai-authenticated-user-email", "owner@arks.test");
    headers.set("oai-authenticated-user-full-name", "Campus Owner");
    return api(
      new Request(new URL(path, "https://campus.test"), {
        ...options,
        headers,
      }),
      env,
    );
  };
  await fs.mkdir(".local", { recursive: true });
  await build({
    entryPoints: ["src/main.jsx"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: ".local/ui-test-inbox.mjs",
    packages: "external",
    loader: { ".css": "empty" },
  });
  const { act } = await import("react");
  async function settle(fn = () => {}) {
    await act(async () => {
      await fn();
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  try {
    // Bootstrap & seed inbox items + published image & PDF files
    await globalThis.fetch("/api/bootstrap");
    const now = new Date().toISOString();
    await env.BUCKET.put("img-file-1", new TextEncoder().encode("pngdata"));
    await env.BUCKET.put("pdf-file-1", new TextEncoder().encode("%PDF-1.4"));
    await env.DB.prepare(
      "INSERT INTO files (id,owner_id,name,mime,size,created) VALUES (?,?,?,?,?,?)",
    )
      .bind("img-file-1", "owner", "k8s-arch.png", "image/png", 7, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO files (id,owner_id,name,mime,size,created) VALUES (?,?,?,?,?,?)",
    )
      .bind("pdf-file-1", "owner", "docker-notes.pdf", "application/pdf", 8, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO content (id,course_id,batch_id,kind,title,topic,topic_order,body,url,starts_at,duration,file_id,published,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        "c-img-1",
        "devops",
        "sandbox",
        "image",
        "K8s Architecture Diagram",
        "Kubernetes",
        2,
        "Cluster topology diagram",
        "",
        "",
        60,
        "img-file-1",
        1,
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO content (id,course_id,batch_id,kind,title,topic,topic_order,body,url,starts_at,duration,file_id,published,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        "c-pdf-1",
        "devops",
        "sandbox",
        "notes",
        "Docker Deep Dive PDF",
        "Docker",
        2,
        "Full Docker class notes",
        "",
        "",
        60,
        "pdf-file-1",
        1,
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO automation_sources (id,batch_id,folder_input,folder_id,enabled,config,created) VALUES (?,?,?,?,?,?,?)",
    )
      .bind("src-1", "sandbox", "DevOps Folder", "fld_1234567890", 1, "{}", now)
      .run();
    await env.DB.prepare(
      "INSERT INTO import_items (id,source_id,generation,drive_file_id,revision,kind,title,topic,topic_order,source_path,source_url,mime,size,status,class_date,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        "imp-1",
        "src-1",
        1,
        "drv_img_123456",
        "v1",
        "image",
        "VPC Diagram.png",
        "Networking",
        1,
        "batch/images",
        "https://drive.google.com/file/d/drv_img_123456/view",
        "image/png",
        100,
        "pending",
        "2026-11-22",
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO import_items (id,source_id,generation,drive_file_id,revision,kind,title,topic,topic_order,source_path,source_url,mime,size,status,class_date,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        "imp-2",
        "src-1",
        1,
        "drv_pdf_123456",
        "v1",
        "notes",
        "Terraform Guide.pdf",
        "Terraform",
        1,
        "batch/notes",
        "https://drive.google.com/file/d/drv_pdf_123456/view",
        "application/pdf",
        200,
        "pending",
        "2026-11-22",
        now,
      )
      .run();

    await settle(() =>
      import("../.local/ui-test-inbox.mjs?test=" + Date.now()),
    );
    const closeBtn = document.querySelector('[aria-label="Close dialog"]');
    if (closeBtn) await settle(() => closeBtn.click());
    const button = (s) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === s,
      );
    const skipBtn = button("Skip");
    if (skipBtn) await settle(() => skipBtn.click());

    // Open Classroom & Content -> Content inbox
    await settle(() => button("Classroom & Content").click());
    assert.match(document.body.textContent, /VPC Diagram\.png/);
    assert.match(document.body.textContent, /Terraform Guide\.pdf/);

    // File type filter select exists with expected options
    const selects = [...document.querySelectorAll(".inbox-filters select")];
    const fileTypeSelect = selects.find((s) =>
      [...s.options].some((o) => o.value === "pdf"),
    );
    assert.ok(fileTypeSelect, "Expected File type filter select");

    // Select all visible -> shows Approve Selected & Reject Selected
    await settle(() => button("Select all visible").click());
    assert.ok(
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent.includes("Approve Selected (2)"),
      ),
      "Expected Approve Selected (2) button",
    );
    const rejectBtn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Reject Selected (2)"),
    );
    assert.ok(rejectBtn, "Expected Reject Selected (2) button");

    // Click Reject Selected (2)
    await settle(() => rejectBtn.click());
    assert.match(document.body.textContent, /Your review queue is clear/);
    const rejRows = (
      await env.DB.prepare(
        "SELECT id,status FROM import_items WHERE id IN ('imp-1','imp-2')",
      ).all()
    ).results;
    assert.equal(rejRows.length, 2);
    assert.ok(rejRows.every((r) => r.status === "rejected"));

    // Switch to Student View -> Learning library -> verify Inline Image & PDF readers
    await settle(() => button("Switch to student view").click());
    const skip2 = button("Skip");
    if (skip2) await settle(() => skip2.click());
    await settle(() =>
      [...document.querySelectorAll("nav button")]
        .find((b) => b.textContent.includes("Learning library"))
        .click(),
    );

    // Open Image resource -> inline image preview + Open Full Image + Download Image
    const imgCard = [...document.querySelectorAll(".resource-card")].find((el) =>
      el.textContent.includes("K8s Architecture Diagram"),
    );
    assert.ok(imgCard, "Expected K8s Architecture Diagram card in Learning library");
    await settle(() => imgCard.click());
    const previewImg = document.querySelector("img.inline-preview-img");
    assert.ok(previewImg, "Expected inline image viewer");
    assert.match(previewImg.getAttribute("src") || "", /\/api\/files\/img-file-1\?inline=1/);
    assert.match(document.body.textContent, /Open Full Image/);
    assert.match(document.body.textContent, /Download Image/);
    await settle(() =>
      document.querySelector('[aria-label="Close dialog"]').click(),
    );

    // Open PDF resource -> inline PDF iframe + Open PDF in New Tab + Download PDF
    const pdfCard = [...document.querySelectorAll(".resource-card")].find((el) =>
      el.textContent.includes("Docker Deep Dive PDF"),
    );
    assert.ok(pdfCard, "Expected Docker Deep Dive PDF card in Learning library");
    await settle(() => pdfCard.click());
    const previewFrame = document.querySelector("iframe.inline-preview-frame");
    assert.ok(previewFrame, "Expected inline PDF iframe reader");
    assert.match(
      previewFrame.getAttribute("src") || "",
      /\/api\/files\/pdf-file-1\?inline=1/,
    );
    assert.match(document.body.textContent, /Open PDF in New Tab/);
    assert.match(document.body.textContent, /Download PDF/);
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("Students & Team cleanly separates Students, Trainers & Admins, and Batch Groups assignment flow", async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: "https://campus.test",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    LOCAL_DEV_OWNER: "true",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set("oai-authenticated-user-id", "owner");
    headers.set("oai-authenticated-user-email", "owner@arks.test");
    headers.set("oai-authenticated-user-full-name", "Campus Owner");
    return api(
      new Request(new URL(path, "https://campus.test"), {
        ...options,
        headers,
      }),
      env,
    );
  };
  await fs.mkdir(".local", { recursive: true });
  await build({
    entryPoints: ["src/main.jsx"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: ".local/ui-test-people.mjs",
    packages: "external",
    loader: { ".css": "empty" },
  });
  const { act } = await import("react");
  async function settle(fn = () => {}) {
    await act(async () => {
      await fn();
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  try {
    await globalThis.fetch("/api/bootstrap");
    // Seed 1 student, 1 trainer, and 1 batch group
    await globalThis.fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Rohan Learner",
        email: "rohan.learner@arks.test",
        role: "student",
      }),
    });
    await globalThis.fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Meera Instructor",
        email: "meera.trainer@arks.test",
        role: "trainer",
      }),
    });
    await globalThis.fetch("/api/admin/group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_id: "sandbox",
        name: "Evening Cohort Group",
        members: "",
      }),
    });

    await settle(() =>
      import("../.local/ui-test-people.mjs?test=" + Date.now()),
    );
    const closeBtn = document.querySelector('[aria-label="Close dialog"]');
    if (closeBtn) await settle(() => closeBtn.click());
    const button = (s) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === s,
      );
    const skipBtn = button("Skip");
    if (skipBtn) await settle(() => skipBtn.click());

    // Open Students & Team workspace
    await settle(() => button("Students & Team").click());
    const subTabs = [...document.querySelectorAll(".admin-tabs button")].map(
      (b) => b.textContent.trim(),
    );
    assert.deepEqual(subTabs, [
      "Students",
      "Trainers & Admins",
      "Batch Groups",
      "Fees & Payments",
    ]);

    // Students tab shows ONLY students, not trainers/admins
    assert.match(document.body.textContent, /Rohan Learner/);
    assert.doesNotMatch(document.body.textContent, /Meera Instructor/);
    assert.ok(button("Create Student"), "Expected Create Student button");

    // Switch to Trainers & Admins tab -> shows ONLY staff, not students
    await settle(() => button("Trainers & Admins").click());
    assert.match(document.body.textContent, /Meera Instructor/);
    assert.match(document.body.textContent, /Campus Owner/);
    assert.doesNotMatch(document.body.textContent, /Rohan Learner/);
    assert.ok(
      button("Create Trainer / Admin"),
      "Expected Create Trainer / Admin button",
    );

    // Switch to Batch Groups tab -> shows Step 1, Step 2 (existing students), Step 3
    await settle(() => button("Batch Groups").click());
    assert.match(document.body.textContent, /Step 1 — Select Batch & Batch Group/);
    assert.match(document.body.textContent, /Evening Cohort Group/);
    assert.match(document.body.textContent, /Step 2 — Add Existing Students/);
    assert.match(document.body.textContent, /Rohan Learner/);
    assert.match(document.body.textContent, /Step 3 — Current Group Members/);
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
