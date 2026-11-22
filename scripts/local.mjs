// Standalone local development only. This script is never bundled into production.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { database } from "./database.mjs";
const DB = await database(".local/campus.sqlite");
const BUCKET = {
  async put(k, v) {
    await fs.mkdir(".local/files", { recursive: true });
    await fs.writeFile(".local/files/" + k, Buffer.from(v));
  },
  async get(k) {
    try {
      return { body: await fs.readFile(".local/files/" + k) };
    } catch {
      return null;
    }
  },
  async delete(k) {
    await fs.rm(".local/files/" + k, { force: true });
  },
};
const { default: worker } = await import("../dist/server/index.js");
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers(req.headers);
    headers.set("oai-authenticated-user-id", "local-owner");
    headers.set("oai-authenticated-user-email", "owner@arks.local");
    headers.set("oai-authenticated-user-full-name", "Campus Owner");
    const request = new Request("http://127.0.0.1:4173" + req.url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : Buffer.concat(chunks),
    });
    const out = await worker.fetch(request, {
      DB,
      BUCKET,
      LOCAL_DEV_OWNER: "true",
    });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Local server error");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log(
    "Local-only campus at http://127.0.0.1:4173; seeded development identity. Never expose this server to a network.",
  ),
);
