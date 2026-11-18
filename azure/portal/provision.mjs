// Provision one central PostgreSQL campus database. Credentials arrive via stdin only.
import fs from "node:fs/promises";
import pg from "pg";
import { PostgresDatabase, postgresConfig } from "./postgres-database.js";
import { setAdminPassword } from "../../server/auth.js";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  throw Error("Invalid provisioning input.");
}
if (
  !/^[\w.-]+\.postgres\.database\.azure\.com$/.test(input.host) ||
  !/^[a-z_][a-z0-9_]{0,62}$/.test(input.database) ||
  !/^[a-z_][a-z0-9_]{0,62}$/.test(input.portalUser)
)
  throw Error("Unexpected PostgreSQL resource names.");
const env = {
  PORTAL_PG_HOST: input.host,
  PORTAL_PG_DATABASE: input.database,
  PORTAL_PG_USER: input.adminUser,
  PORTAL_PG_PASSWORD: input.adminPassword,
};
const qi = (s) => '"' + s.replaceAll('"', '""') + '"',
  literal = (s) => "'" + s.replaceAll("'", "''") + "'";
let pool, db;
try {
  pool = new pg.Pool(postgresConfig(env));
  const ddl = await fs.readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  await pool.query(ddl);
  const exists = await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
    input.portalUser,
  ]);
  await pool.query(
    (exists.rowCount ? "ALTER ROLE " : "CREATE ROLE ") +
      qi(input.portalUser) +
      " LOGIN PASSWORD " +
      literal(input.portalPassword),
  );
  await pool.query(
    "GRANT CONNECT ON DATABASE " +
      qi(input.database) +
      " TO " +
      qi(input.portalUser),
  );
  await pool.query("GRANT USAGE ON SCHEMA arks TO " + qi(input.portalUser));
  await pool.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA arks TO " +
      qi(input.portalUser),
  );
  db = new PostgresDatabase(env);
  await setAdminPassword(
    db,
    { role: "admin" },
    {
      email: input.ownerEmail,
      name: "Institute administrator",
      password: input.ownerPassword,
    },
  );
  const owner = await db
    .prepare("SELECT id FROM users WHERE email=?")
    .bind(input.ownerEmail.trim().toLowerCase())
    .first();
  await db
    .prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('owner',?)")
    .bind(owner.id)
    .run();
  console.log(
    "Central PostgreSQL schema, limited portal role and administrator initialized. No secrets displayed.",
  );
} catch {
  process.exitCode = 1;
  console.error(
    "Database initialization failed. Check PostgreSQL TLS, firewall, administrator credentials and role/schema permissions. Raw driver output suppressed.",
  );
} finally {
  if (db) await db.close();
  if (pool) await pool.end();
  input = null;
}
