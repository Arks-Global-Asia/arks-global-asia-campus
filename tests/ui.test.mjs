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
});
