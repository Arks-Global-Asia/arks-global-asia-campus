import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { api } from "../server/api.js";
import { database, memoryBucket } from "../scripts/database.mjs";
import { classifyMaterial, folderInput } from "../server/automation.js";
const token = "test-only-worker-token",
  root = "folder_123456789",
  owner = { id: "owner", email: "owner@arks.test" };
async function setup() {
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    LOCAL_DEV_OWNER: "true",
    IMPORTER_TOKEN_SHA256: createHash("sha256").update(token).digest("hex"),
  };
  async function call(path, body, who = "service") {
    const headers = { "Content-Type": "application/json" };
    if (who === "service") headers["X-Arks-Importer-Token"] = token;
    else if (who) {
      headers["oai-authenticated-user-id"] = who.id;
      headers["oai-authenticated-user-email"] = who.email;
    }
    const res = await api(
      new Request("https://campus.test/api/" + path, {
        method: body ? "POST" : "GET",
        body: body ? JSON.stringify(body) : undefined,
        headers,
      }),
      env,
    );
    return { status: res.status, data: await res.json() };
  }
  await call("bootstrap", null, owner);
  const config = await call(
    "admin/automation/source",
    {
      batch_id: "sandbox",
      folder_input: "https://drive.google.com/drive/folders/" + root,
    },
    owner,
  );
  return { env, call, source: config.data.id };
}
const item = (patch = {}) => ({
  drive_file_id: "file_123456789",
  revision: "2026-11-16T00:00:00Z",
  name: "Day08_Docker_notes.pdf",
  source_path: "notes/pdf",
  mime: "application/pdf",
  size: 100,
  url: "https://drive.google.com/file/d/file_123456789/view",
  ancestor_ids: [root],
  ...patch,
});
test("automation service rejects unauthenticated and student requests, never inherits visitor role", async () => {
  const { call } = await setup();
  assert.equal((await call("automation/sources", null, null)).status, 401);
  assert.equal((await call("automation/sources", null, owner)).status, 401);
  assert.equal(
    (
      await call("admin/automation/state", null, {
        id: "s",
        email: "s@test.com",
      })
    ).status,
    403,
  );
});
test("folder names and links resolve conservatively; duplicate scans cannot run together", async () => {
  assert.equal(folderInput("Batch 02").id, null);
  assert.throws(() => folderInput("https://evil.test/drive/folders/" + root));
  const { call, source } = await setup();
  const r = await call("automation/claim", { source_id: source });
  assert.equal(r.status, 200);
  assert.equal(
    (await call("automation/claim", { source_id: source })).status,
    409,
  );
  assert.equal(
    (
      await call("automation/resolve", {
        run_id: r.data.run_id,
        folder_id: "other_folder_123",
        folder_name: "Wrong",
      })
    ).status,
    400,
  );
});
test("imports deduplicate and stay hidden until explicit admin approval", async () => {
  const { call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const ing = await call("automation/ingest", {
    run_id: r.run_id,
    items: [item()],
  });
  assert.equal(ing.status, 200);
  const id = ing.data.items[0].id;
  const repeated = await call("automation/ingest", {
    run_id: r.run_id,
    items: [item()],
  });
  assert.equal(repeated.data.items[0].id, id);
  assert.equal(repeated.data.items[0].duplicate, true);
  assert.ok(
    !(await call("campus?batch=sandbox", null, owner)).data.content.some((c) =>
      c.title.includes("Day08"),
    ),
  );
  assert.equal(
    (await call("admin/automation/review", { id, action: "approve" }, owner))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        "admin/automation/review",
        { id, action: "approve", confirmed_student_safe: true },
        owner,
      )
    ).status,
    200,
  );
  assert.ok(
    (await call("campus?batch=sandbox", null, owner)).data.content.some((c) =>
      c.title.includes("Day08"),
    ),
  );
  assert.equal(
    (await call("automation/review", { id, action: "approve" })).status,
    404,
  );
});
test("answer keys, results and out-of-folder files cannot leak through approval", async () => {
  assert.equal(
    classifyMaterial(
      "Day8_Answers.docx",
      "labs/lab_answers",
      "application/msword",
    ),
    "private",
  );
  assert.equal(
    classifyMaterial(
      "Results.xlsx",
      "knowledge_tests/results",
      "application/octet-stream",
    ),
    "private",
  );
  const { call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const blocked = await call("automation/ingest", {
    run_id: r.run_id,
    items: [item({ source_path: "labs/lab_answers" })],
  });
  assert.equal(blocked.data.items[0].status, "restricted");
  assert.equal(
    (
      await call(
        "admin/automation/review",
        {
          id: blocked.data.items[0].id,
          action: "approve",
          confirmed_student_safe: true,
        },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call("automation/ingest", {
        run_id: r.run_id,
        items: [item({ ancestor_ids: ["wrong"] })],
      })
    ).status,
    400,
  );
});
test("changed source invalidates old scan and approval; approved items remain in original batch", async () => {
  const { call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const ing = (
    await call("automation/ingest", { run_id: r.run_id, items: [item()] })
  ).data;
  await call(
    "admin/automation/source",
    { batch_id: "sandbox", folder_input: "New batch folder" },
    owner,
  );
  assert.equal(
    (await call("automation/ingest", { run_id: r.run_id, items: [item()] }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(
        "admin/automation/review",
        {
          id: ing.items[0].id,
          action: "approve",
          confirmed_student_safe: true,
        },
        owner,
      )
    ).status,
    409,
  );
});
test("new revisions require another approval and retain the earlier published copy", async () => {
  const { call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const first = (
    await call("automation/ingest", { run_id: r.run_id, items: [item()] })
  ).data.items[0];
  const published = await call(
    "admin/automation/review",
    { id: first.id, action: "approve", confirmed_student_safe: true },
    owner,
  );
  const second = (
    await call("automation/ingest", {
      run_id: r.run_id,
      items: [item({ revision: "v2", name: "Day08_Docker_revised.pdf" })],
    })
  ).data.items[0];
  let content = (
    await call("campus?batch=sandbox", null, owner)
  ).data.content.find((c) => c.id === published.data.content_id);
  assert.match(content.title, /notes/);
  await call(
    "admin/automation/review",
    { id: second.id, action: "approve", confirmed_student_safe: true },
    owner,
  );
  content = (await call("campus?batch=sandbox", null, owner)).data.content.find(
    (c) => c.id === published.data.content_id,
  );
  assert.match(content.title, /revised/);
});
test("external test release requires a student form URL, not an editor or answer key", async () => {
  const { call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const i = (
    await call("automation/ingest", {
      run_id: r.run_id,
      items: [
        item({
          source_path: "knowledge_tests",
          mime: "application/vnd.google-apps.form",
        }),
      ],
    })
  ).data.items[0];
  assert.equal(
    (
      await call(
        "admin/automation/review",
        {
          id: i.id,
          action: "approve",
          confirmed_student_safe: true,
          student_url: "https://docs.google.com/forms/d/abcdef/edit",
        },
        owner,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "admin/automation/review",
        {
          id: i.id,
          action: "approve",
          confirmed_student_safe: true,
          student_url: "https://docs.google.com/forms/d/e/abcdef/viewform",
        },
        owner,
      )
    ).status,
    200,
  );
  const c = (await call("campus?batch=sandbox", null, owner)).data.content.find(
    (c) => c.kind === "test_link",
  );
  assert.equal(c.url, "");
});

test("images, resource_creation guides, yaml/sh scripts, exclusion filters, category override and 1-click bunch approval work end-to-end", async () => {
  assert.equal(
    classifyMaterial("k8s-architecture.png", "batch/images", "image/png"),
    "image",
  );
  assert.equal(
    classifyMaterial("vpc-topology.jpg", "batch/diagrams", "image/jpeg"),
    "image",
  );
  assert.equal(
    classifyMaterial("aks-cluster-setup.pdf", "batch/resource_creation", "application/pdf"),
    "guide",
  );
  assert.equal(
    classifyMaterial("deployment.yaml", "batch/manifests", "text/yaml"),
    "notes",
  );
  assert.equal(
    classifyMaterial("bootstrap.sh", "batch/scripts", "text/x-shellscript"),
    "notes",
  );
  assert.equal(
    classifyMaterial(
      "secret-notes.pdf",
      "batch/custom_hidden_dir",
      "application/pdf",
      { excluded_folders: ["custom_hidden_dir"] },
    ),
    "private",
  );
  assert.equal(
    classifyMaterial(
      "backup-notes.bak",
      "batch/notes",
      "application/octet-stream",
      { excluded_extensions: ["bak", ".tmp"] },
    ),
    "private",
  );

  const { call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const ing = await call("automation/ingest", {
    run_id: r.run_id,
    items: [
      item({
        drive_file_id: "file_img_12345",
        url: "https://drive.google.com/file/d/file_img_12345/view",
        name: "Day09_K8s_Diagram.png",
        source_path: "batch/images",
        mime: "image/png",
        modified_time: "2026-11-20T16:15:00Z",
      }),
      item({
        drive_file_id: "file_guide_12345",
        url: "https://drive.google.com/file/d/file_guide_12345/view",
        name: "Day09_Resource_Creation_Guide.pdf",
        source_path: "batch/resource_creation",
        mime: "application/pdf",
        modified_time: "2026-11-20T16:20:00Z",
      }),
      item({
        drive_file_id: "file_restricted_12345",
        url: "https://drive.google.com/file/d/file_restricted_12345/view",
        name: "Day09_Working_Draft.md",
        source_path: "batch/draft",
        mime: "text/markdown",
        modified_time: "2026-11-20T16:25:00Z",
      }),
    ],
  });
  assert.equal(ing.status, 200);
  assert.equal(ing.data.items[0].status, "pending");
  assert.equal(ing.data.items[1].status, "pending");
  assert.equal(ing.data.items[2].status, "restricted");

  // 1-click Bunch Approval approves both pending student-safe items for class_date 2026-11-20 and publishes them to content
  const bunch = await call(
    "admin/automation/approve-batch",
    {
      batch_id: "sandbox",
      class_date: "2026-11-20",
      confirmed_student_safe: true,
    },
    owner,
  );
  assert.equal(bunch.status, 200);
  assert.equal(bunch.data.approved_count, 2);

  const campusBeforeOverride = (await call("campus?batch=sandbox", null, owner)).data.content;
  assert.ok(campusBeforeOverride.some((c) => c.kind === "image" && c.title.includes("Day09")));
  assert.ok(campusBeforeOverride.some((c) => c.kind === "guide" && c.title.includes("Day09")));

  // Trainer/Admin can override category on restricted item when explicitly choosing a student-facing kind
  const overridden = await call(
    "admin/automation/review",
    {
      id: ing.data.items[2].id,
      action: "approve",
      kind: "notes",
      confirmed_student_safe: true,
    },
    owner,
  );
  assert.equal(overridden.status, 200);
});

test("bulk reject endpoint enforces staff auth, validates input, rejects pending/restricted items and records audit", async () => {
  const { env, call, source } = await setup();
  const r = (await call("automation/claim", { source_id: source })).data;
  const ing = await call("automation/ingest", {
    run_id: r.run_id,
    items: [
      item({
        drive_file_id: "file_rej_12345",
        url: "https://drive.google.com/file/d/file_rej_12345/view",
        name: "Day10_Old_Slide.pptx",
        source_path: "batch/slides",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
      item({
        drive_file_id: "file_rej_67890",
        url: "https://drive.google.com/file/d/file_rej_67890/view",
        name: "Day10_Answers.pdf",
        source_path: "batch/lab_answers",
        mime: "application/pdf",
      }),
    ],
  });
  assert.equal(ing.status, 200);
  const ids = ing.data.items.map((x) => x.id);

  // Student cannot call reject-batch
  const studentRes = await call(
    "admin/automation/reject-batch",
    { item_ids: ids },
    { id: "stu1", email: "stu1@arks.test" },
  );
  assert.equal(studentRes.status, 403);

  // Empty item_ids rejected with 400
  const emptyRes = await call(
    "admin/automation/reject-batch",
    { item_ids: [] },
    owner,
  );
  assert.equal(emptyRes.status, 400);

  // Staff bulk rejects both pending and restricted items
  const res = await call(
    "admin/automation/reject-batch",
    { item_ids: ids, note: "Outdated deck and answer key" },
    owner,
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.rejected_count, 2);

  const state = (await call("admin/automation/state", null, owner)).data;
  for (const id of ids) {
    const found = state.items.find((x) => x.id === id);
    assert.equal(found.status, "rejected");
    assert.equal(found.review_note, "Outdated deck and answer key");
    assert.equal(found.reviewed_by, owner.id);
  }

  const auditRow = await env.DB.prepare(
    "SELECT * FROM audit WHERE action='reject_batch:import' ORDER BY created DESC LIMIT 1",
  ).first();
  assert.ok(auditRow);
  assert.equal(auditRow.actor, owner.id);
});
