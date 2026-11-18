// Test-only. Each fixture receives an isolated PostgreSQL database.
import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";
import { PostgresDatabase, postgresConfig } from "./postgres-database.js";
const active = [];
export async function cleanupPgTests() {
  for (const { db, master, name } of active.splice(0)) {
    await db.close();
    try {
      await master.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    } finally {
      await master.end();
    }
  }
}
export async function pgTestDatabase() {
  const env = JSON.parse(
      await fs.readFile(process.env.ARKS_TEST_PG_CONFIG, "utf8"),
    ),
    master = new pg.Pool(
      postgresConfig({ ...env, PORTAL_PG_DATABASE: "postgres" }),
    ),
    name = "arkstest_" + crypto.randomUUID().replaceAll("-", "");
  await master.query('CREATE DATABASE "' + name + '"');
  const db = new PostgresDatabase({ ...env, PORTAL_PG_DATABASE: name });
  active.push({ db, master, name });
  await db
    .pool()
    .query(await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  return db;
}
