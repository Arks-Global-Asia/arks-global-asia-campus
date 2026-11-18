// Reads service credentials through hidden stdin; never persists them.
import { spawnSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const origin =
  "https://arks-global-asia-institutes.majesticanchovy2.chatgpt.site";
if (process.stdin.isTTY) spawnSync("stty", ["-echo"], { stdio: "inherit" });
console.log("Ready for automation request JSON on stdin (input is hidden).");
const input = await new Promise((resolve) => {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  rl.once("line", (s) => {
    rl.close();
    resolve(s);
  });
});
if (process.stdin.isTTY) spawnSync("stty", ["echo"], { stdio: "inherit" });
let d;
try {
  d = JSON.parse(input);
} catch {
  throw new Error(
    "Invalid automation input. Pass large non-secret request bodies using body_file.",
  );
}
if (d.operation === "fingerprint") {
  console.log(
    JSON.stringify({
      fingerprint: createHash("sha256").update(d.token).digest("hex"),
    }),
  );
  process.exit(0);
}
if (
  !/^\/api\/automation\/(sources|state|prepare|claim|resolve|ingest|upload|finish)$/.test(
    d.path,
  )
)
  throw new Error("Unsupported automation path");
const headers = {
  "OAI-Sites-Authorization": "Bearer " + d.token,
  "X-Arks-Importer-Token": d.token,
};
let body = d.body;
if (d.body_file) body = JSON.parse(await fs.readFile(d.body_file, "utf8"));
if (d.file_path) {
  const form = new FormData();
  form.set("run_id", d.run_id);
  form.set("item_id", d.item_id);
  form.set(
    "file",
    new File(
      [await fs.readFile(d.file_path)],
      d.file_name || path.basename(d.file_path),
      { type: d.mime || "application/octet-stream" },
    ),
  );
  body = form;
} else if (body) {
  headers["Content-Type"] = "application/json";
  body = JSON.stringify(body);
}
const r = await fetch(origin + d.path, {
  method: body ? "POST" : "GET",
  headers,
  body,
  redirect: "manual",
});
const raw = await r.text();
let result;
try {
  result = JSON.parse(raw);
} catch {
  result = { error: "Non-JSON response from campus", status: r.status };
}
console.log(JSON.stringify({ status: r.status, data: result }));
if (!r.ok) process.exitCode = 1;
