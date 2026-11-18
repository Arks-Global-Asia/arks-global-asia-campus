import pg from "pg";
import { compilePostgres } from "./postgres-compiler.js";
const NUMERIC_FIELDS = new Set([
  "fee",
  "amount",
  "size",
  "reset_at",
  "score",
  "total",
  "n",
]);
export function postgresConfig(env) {
  if (
    !env.PORTAL_PG_HOST ||
    !env.PORTAL_PG_DATABASE ||
    !env.PORTAL_PG_USER ||
    !env.PORTAL_PG_PASSWORD
  )
    throw Object.assign(Error("The campus database has not been configured."), {
      status: 503,
    });
  const schema = env.PORTAL_PG_SCHEMA || "arks";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
    throw Object.assign(Error("Invalid campus database schema."), {
      status: 503,
    });
  const local =
    env.PORTAL_PG_ALLOW_LOCAL === "true" &&
    ["localhost", "127.0.0.1"].includes(env.PORTAL_PG_HOST);
  return {
    host: env.PORTAL_PG_HOST,
    port: Number(env.PORTAL_PG_PORT || 5432),
    database: env.PORTAL_PG_DATABASE,
    user: env.PORTAL_PG_USER,
    password: env.PORTAL_PG_PASSWORD,
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          ...(env.PORTAL_PG_CA ? { ca: env.PORTAL_PG_CA } : {}),
        },
    options: "-c search_path=" + schema + ",public",
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 18000,
  };
}
function normalize(row) {
  for (const [key, value] of Object.entries(row)) {
    if (
      NUMERIC_FIELDS.has(key) &&
      typeof value === "string" &&
      /^-?\d+(\.\d+)?$/.test(value)
    ) {
      const n = Number(value);
      if (
        !Number.isFinite(n) ||
        (Number.isInteger(n) && !Number.isSafeInteger(n))
      )
        throw Error("Stored number exceeds safe application range");
      row[key] = n;
    }
  }
  return row;
}
function safeError(e) {
  if (["40001", "40P01"].includes(e.code)) return e;
  if (e.code === "23505")
    return Object.assign(
      Error("This record already exists. Refresh and try again."),
      { status: 409 },
    );
  return Object.assign(
    Error(
      "The campus database could not be reached. Please retry or contact support.",
    ),
    { status: 503 },
  );
}
export class PostgresDatabase {
  constructor(env) {
    this.env = env;
    this.connection = null;
  }
  pool() {
    if (!this.connection) {
      this.connection = new pg.Pool(postgresConfig(this.env));
      this.connection.on("error", () => {});
    }
    return this.connection;
  }
  prepare(sql) {
    return new Statement(this, sql, []);
  }
  async execute(statement, client) {
    try {
      const q = compilePostgres(statement.sql, statement.args);
      return await (client || this.pool()).query(q);
    } catch (e) {
      throw safeError(e);
    }
  }
  async batch(statements) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let client;
      try {
        client = await this.pool().connect();
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const result = [];
        for (const s of statements) {
          const r = await this.execute(s, client);
          result.push({ success: true, meta: { changes: r.rowCount || 0 } });
        }
        await client.query("COMMIT");
        return result;
      } catch (e) {
        if (client)
          try {
            await client.query("ROLLBACK");
          } catch {}
        if (["40001", "40P01"].includes(e.code) && attempt < 2) continue;
        if (["40001", "40P01"].includes(e.code))
          throw Object.assign(
            Error("The campus database is busy. Please retry."),
            { status: 503 },
          );
        throw safeError(e);
      } finally {
        client?.release();
      }
    }
  }
  async close() {
    if (this.connection) await this.connection.end();
    this.connection = null;
  }
}
class Statement {
  constructor(db, sql, args) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }
  async all() {
    return { results: (await this.db.execute(this)).rows.map(normalize) };
  }
  async first() {
    return (await this.all()).results[0] || null;
  }
  async run() {
    return (await this.db.batch([this]))[0];
  }
}
