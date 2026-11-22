import pg from "pg";
import { BlobServiceClient } from "@azure/storage-blob";
import { api } from "./api.js";

// Ensure BIGINT (OID 20) and NUMERIC (OID 1700) return as JavaScript Numbers
// matching SQLite / Cloudflare D1 behavior for COUNT(*), SUM(), timestamps, etc.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export function translateSqliteToPg(rawSql) {
  let sql = String(rawSql || "").trim();
  const isInsertOrIgnore = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
  if (isInsertOrIgnore) {
    sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
  }

  let out = "";
  let paramIndex = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      out += ch;
      continue;
    }
    if (ch === "?" && !inSingleQuote && !inDoubleQuote) {
      paramIndex++;
      out += `$${paramIndex}`;
      continue;
    }
    out += ch;
  }

  if (isInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(out)) {
    out = out.replace(/;?\s*$/, "") + " ON CONFLICT DO NOTHING";
  }

  return out;
}

export const PG_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS courses (
    id text PRIMARY KEY NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    syllabus text NOT NULL,
    fee integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'INR' NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS batches (
    id text PRIMARY KEY NOT NULL,
    course_id text NOT NULL REFERENCES courses(id),
    name text NOT NULL,
    start_date text NOT NULL,
    end_date text NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata' NOT NULL,
    covered integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    config text DEFAULT '{}' NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role text DEFAULT 'student' NOT NULL,
    phone text DEFAULT '',
    goal text DEFAULT '',
    onboarded integer DEFAULT 0,
    active integer DEFAULT 1 NOT NULL,
    created text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_email ON users (email)`,
  `CREATE TABLE IF NOT EXISTS content (
    id text PRIMARY KEY NOT NULL,
    course_id text NOT NULL REFERENCES courses(id),
    batch_id text REFERENCES batches(id),
    kind text NOT NULL,
    title text NOT NULL,
    topic text NOT NULL,
    topic_order integer DEFAULT 1 NOT NULL,
    body text DEFAULT '' NOT NULL,
    url text DEFAULT '' NOT NULL,
    starts_at text DEFAULT '' NOT NULL,
    duration integer DEFAULT 60 NOT NULL,
    file_id text,
    published integer DEFAULT 1 NOT NULL,
    session_status text DEFAULT 'scheduled' NOT NULL,
    series_id text,
    created text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS content_course ON content (course_id, kind)`,
  `CREATE TABLE IF NOT EXISTS tests (
    id text PRIMARY KEY NOT NULL,
    course_id text NOT NULL REFERENCES courses(id),
    title text NOT NULL,
    kind text NOT NULL,
    topic_order integer NOT NULL,
    duration integer NOT NULL,
    questions text NOT NULL,
    published integer DEFAULT 1 NOT NULL,
    batch_id text,
    source_ids text DEFAULT '[]' NOT NULL,
    ai_generated integer DEFAULT 0 NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attempts (
    id text PRIMARY KEY NOT NULL,
    test_id text NOT NULL REFERENCES tests(id),
    user_id text NOT NULL REFERENCES users(id),
    batch_id text NOT NULL REFERENCES batches(id),
    started text NOT NULL,
    submitted text,
    answers text,
    score double precision,
    total integer,
    snapshot text NOT NULL,
    feedback text,
    grading_status text DEFAULT 'complete' NOT NULL,
    summary text DEFAULT '{}' NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS attempt_user ON attempts (user_id, test_id)`,
  `CREATE TABLE IF NOT EXISTS completions (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    batch_id text NOT NULL REFERENCES batches(id),
    content_id text NOT NULL REFERENCES content(id),
    created text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS completion_unique ON completions (user_id, batch_id, content_id)`,
  `CREATE TABLE IF NOT EXISTS enrollments (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    batch_id text NOT NULL REFERENCES batches(id),
    fee integer NOT NULL,
    created text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS enrollment_user_batch ON enrollments (user_id, batch_id)`,
  `CREATE TABLE IF NOT EXISTS files (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    name text NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    created text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invitations (
    id text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    batch_id text NOT NULL REFERENCES batches(id),
    role text DEFAULT 'student' NOT NULL,
    fee integer DEFAULT 0 NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invite_email_batch ON invitations (email, batch_id)`,
  `CREATE TABLE IF NOT EXISTS payments (
    id text PRIMARY KEY NOT NULL,
    enrollment_id text NOT NULL REFERENCES enrollments(id),
    amount integer NOT NULL,
    reference text NOT NULL,
    paid_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payment_reference ON payments (reference)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS submissions (
    id text PRIMARY KEY NOT NULL,
    content_id text NOT NULL REFERENCES content(id),
    user_id text NOT NULL REFERENCES users(id),
    batch_id text NOT NULL REFERENCES batches(id),
    body text NOT NULL,
    file_id text,
    feedback text DEFAULT '' NOT NULL,
    status text DEFAULT 'submitted' NOT NULL,
    drive_url text,
    drive_status text DEFAULT 'not_requested' NOT NULL,
    created text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    batch_id text NOT NULL REFERENCES batches(id),
    subject text NOT NULL,
    body text NOT NULL,
    reply text DEFAULT '' NOT NULL,
    status text DEFAULT 'open' NOT NULL,
    category text DEFAULT 'academic' NOT NULL,
    messages text DEFAULT '[]' NOT NULL,
    created text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    id text PRIMARY KEY NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    entity text NOT NULL,
    created text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS automation_sources (
    id text PRIMARY KEY NOT NULL,
    batch_id text NOT NULL REFERENCES batches(id),
    folder_input text NOT NULL,
    folder_id text,
    folder_name text,
    enabled integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    last_sync text,
    last_error text,
    sync_requested integer DEFAULT 1 NOT NULL,
    generation integer DEFAULT 1 NOT NULL,
    config text DEFAULT '{}' NOT NULL,
    created text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS source_batch ON automation_sources (batch_id)`,
  `CREATE TABLE IF NOT EXISTS import_items (
    id text PRIMARY KEY NOT NULL,
    source_id text NOT NULL REFERENCES automation_sources(id),
    generation integer NOT NULL,
    drive_file_id text NOT NULL,
    revision text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    topic text NOT NULL,
    topic_order integer DEFAULT 1 NOT NULL,
    source_path text NOT NULL,
    source_url text NOT NULL,
    mime text NOT NULL,
    size integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    warning text DEFAULT '' NOT NULL,
    file_id text,
    content_id text,
    review_note text DEFAULT '' NOT NULL,
    reviewed_by text,
    reviewed_at text,
    class_date text DEFAULT '' NOT NULL,
    created text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS import_source_revision ON import_items (source_id, generation, drive_file_id, revision)`,
  `CREATE INDEX IF NOT EXISTS import_status ON import_items (status, source_id)`,
  `CREATE TABLE IF NOT EXISTS import_runs (
    id text PRIMARY KEY NOT NULL,
    source_id text NOT NULL REFERENCES automation_sources(id),
    generation integer NOT NULL,
    status text NOT NULL,
    started text NOT NULL,
    finished text,
    message text DEFAULT '' NOT NULL,
    discovered integer DEFAULT 0 NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_groups (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    google_group text DEFAULT '' NOT NULL,
    batch_id text NOT NULL REFERENCES batches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS group_members (
    group_id text NOT NULL REFERENCES access_groups(id),
    email text NOT NULL,
    PRIMARY KEY (group_id, email)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_credentials (
    user_id text PRIMARY KEY NOT NULL REFERENCES users(id),
    salt text NOT NULL,
    password_hash text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_limits (
    id text PRIMARY KEY NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    reset_at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    expires text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_states (
    id text PRIMARY KEY NOT NULL,
    verifier text NOT NULL,
    expires text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engine_jobs (
    id text PRIMARY KEY NOT NULL,
    kind text NOT NULL,
    batch_id text,
    entity_id text,
    payload text NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    result text,
    error text,
    created text NOT NULL,
    started text,
    finished text,
    lease text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS engine_active_entity ON engine_jobs (kind, entity_id) WHERE status IN ('pending', 'running')`,
  // Idempotent column additions for pre-existing tables
  `ALTER TABLE attempts ADD COLUMN IF NOT EXISTS feedback text`,
  `ALTER TABLE attempts ADD COLUMN IF NOT EXISTS grading_status text DEFAULT 'complete' NOT NULL`,
  `ALTER TABLE attempts ADD COLUMN IF NOT EXISTS summary text DEFAULT '{}' NOT NULL`,
  `ALTER TABLE batches ADD COLUMN IF NOT EXISTS config text DEFAULT '{}' NOT NULL`,
  `ALTER TABLE content ADD COLUMN IF NOT EXISTS session_status text DEFAULT 'scheduled' NOT NULL`,
  `ALTER TABLE content ADD COLUMN IF NOT EXISTS series_id text`,
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS drive_url text`,
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS drive_status text DEFAULT 'not_requested' NOT NULL`,
  `ALTER TABLE tests ADD COLUMN IF NOT EXISTS batch_id text`,
  `ALTER TABLE tests ADD COLUMN IF NOT EXISTS source_ids text DEFAULT '[]' NOT NULL`,
  `ALTER TABLE tests ADD COLUMN IF NOT EXISTS ai_generated integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS active integer DEFAULT 1 NOT NULL`,
  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category text DEFAULT 'academic' NOT NULL`,
  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS messages text DEFAULT '[]' NOT NULL`,
  `ALTER TABLE automation_sources ADD COLUMN IF NOT EXISTS config text DEFAULT '{}' NOT NULL`,
  `ALTER TABLE import_items ADD COLUMN IF NOT EXISTS class_date text DEFAULT '' NOT NULL`,
  `ALTER TABLE auth_limits ALTER COLUMN reset_at TYPE bigint`,
];

let cachedPool = null;
let cachedPoolKey = "";
let initPromise = null;

function resolveSchemaName(rawSchema) {
  const s = String(rawSchema || "public").trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) ? s : "public";
}

export function createPgDb(env = process.env) {
  const host = env.PORTAL_PG_HOST;
  const user = env.PORTAL_PG_USER;
  const password = env.PORTAL_PG_PASSWORD;
  const database = env.PORTAL_PG_DATABASE || "postgres";
  const port = Number(env.PORTAL_PG_PORT || 5432);
  const schema = resolveSchemaName(env.PORTAL_PG_SCHEMA);

  if (!host || !user || !password) {
    return null;
  }

  const poolKey = `${host}:${port}:${user}:${database}:${schema}`;

  async function ensureInitialized() {
    if (!cachedPool || cachedPoolKey !== poolKey) {
      cachedPool = new pg.Pool({
        host,
        port,
        user,
        password,
        database,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        ssl: { rejectUnauthorized: false },
        options: `-c search_path=${schema},public`,
      });
      cachedPool.on("error", () => {
        cachedPool = null;
        initPromise = null;
      });
      cachedPool.on("connect", (client) => {
        client.query(`SET search_path TO "${schema}", public`).catch(() => {});
      });
      cachedPoolKey = poolKey;
      initPromise = null;
    }
    const pool = cachedPool;
    if (!initPromise) {
      initPromise = (async () => {
        let client;
        try {
          client = await pool.connect();
          try {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
          } catch {}
          await client.query(`SET search_path TO "${schema}", public`);
          for (const stmt of PG_SCHEMA_MIGRATIONS) {
            try {
              await client.query(stmt);
            } catch {}
          }
        } catch (err) {
          pool.end().catch(() => {});
          initPromise = null;
          cachedPool = null;
          throw err;
        } finally {
          if (client) client.release();
        }
      })();
    }
    await initPromise;
    return pool;
  }

  class PgStatement {
    constructor(rawSql, args = []) {
      this.rawSql = rawSql;
      this.pgSql = translateSqliteToPg(rawSql);
      this.args = args;
    }
    bind(...args) {
      const next = new PgStatement(this.rawSql, args);
      next.pgSql = this.pgSql;
      return next;
    }
    async all() {
      const pool = await ensureInitialized();
      const res = await pool.query(this.pgSql, this.args);
      return { results: res.rows };
    }
    async first() {
      const pool = await ensureInitialized();
      const res = await pool.query(this.pgSql, this.args);
      return res.rows[0] || null;
    }
    async run() {
      const pool = await ensureInitialized();
      const res = await pool.query(this.pgSql, this.args);
      return {
        success: true,
        meta: { changes: res.rowCount ?? 0 },
      };
    }
  }

  return {
    prepare: (sql) => new PgStatement(sql),
    async batch(statements) {
      const pool = await ensureInitialized();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO "${schema}", public`);
        const results = [];
        for (const s of statements) {
          const sql = s.pgSql || translateSqliteToPg(s.rawSql || s.sql);
          const res = await client.query(sql, s.args || []);
          results.push({
            success: true,
            meta: { changes: res.rowCount ?? 0 },
          });
        }
        await client.query("COMMIT");
        return results;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

let cachedContainerClient = null;
let cachedContainerKey = "";
let containerEnsured = false;

export function createBlobBucket(env = process.env) {
  const connStr = env.PORTAL_BLOB_CONNECTION_STRING;
  const containerName = env.PORTAL_BLOB_CONTAINER || "arks-campus-files";
  if (!connStr) return null;

  const key = `${connStr}::${containerName}`;

  async function getContainerClient(ensureExists = false) {
    if (!cachedContainerClient || cachedContainerKey !== key) {
      const serviceClient = BlobServiceClient.fromConnectionString(connStr);
      cachedContainerClient = serviceClient.getContainerClient(containerName);
      cachedContainerKey = key;
      containerEnsured = false;
    }
    if (ensureExists && !containerEnsured) {
      await cachedContainerClient.createIfNotExists();
      containerEnsured = true;
    }
    return cachedContainerClient;
  }

  return {
    async put(blobKey, data) {
      const containerClient = await getContainerClient(true);
      const blockBlob = containerClient.getBlockBlobClient(String(blobKey));
      const buf = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : Buffer.from(String(data));
      await blockBlob.uploadData(buf);
    },
    async get(blobKey) {
      const containerClient = await getContainerClient(false);
      const blockBlob = containerClient.getBlockBlobClient(String(blobKey));
      try {
        const buf = await blockBlob.downloadToBuffer();
        return { body: buf };
      } catch (err) {
        if (err?.statusCode === 404 || err?.code === "BlobNotFound") {
          return null;
        }
        throw err;
      }
    },
    async delete(blobKey) {
      const containerClient = await getContainerClient(false);
      const blockBlob = containerClient.getBlockBlobClient(String(blobKey));
      await blockBlob.deleteIfExists();
    },
  };
}

export function buildFetchRequest(req, context) {
  const headers = new Headers();
  if (req.headers && typeof req.headers === "object") {
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && v !== null) {
        headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      }
    }
  }

  const segments = context?.bindingData?.segments || req.params?.segments || "";
  const cleanSegments = String(segments).replace(/^\/+/, "");
  const canonicalPath = `/api/${cleanSegments}`;

  let queryStr = "";
  if (req.originalUrl && req.originalUrl.includes("?")) {
    queryStr = "?" + req.originalUrl.split("?").slice(1).join("?");
  } else if (req.url && req.url.includes("?")) {
    queryStr = "?" + req.url.split("?").slice(1).join("?");
  } else if (req.query && Object.keys(req.query).length > 0) {
    queryStr = "?" + new URLSearchParams(req.query).toString();
  }

  let origin = "https://student-portal.arksglobalasia.cloud";
  const msOrigUrl = headers.get("x-ms-original-url");
  if (msOrigUrl) {
    try {
      const parsed = new URL(msOrigUrl);
      origin = parsed.origin;
      if (!queryStr && parsed.search) queryStr = parsed.search;
    } catch {}
  } else {
    const fwdHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const fwdProto =
      headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    const host =
      fwdHost || headers.get("host") || "student-portal.arksglobalasia.cloud";
    const proto =
      host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : fwdProto;
    origin = `${proto}://${host}`;
  }

  const fullUrl = `${origin}${canonicalPath}${queryStr}`;
  const method = String(req.method || "GET").toUpperCase();

  let body;
  if (method !== "GET" && method !== "HEAD") {
    if (Buffer.isBuffer(req.rawBody)) {
      body = req.rawBody;
    } else if (Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (typeof req.rawBody === "string") {
      body = Buffer.from(req.rawBody, "utf8");
    } else if (typeof req.body === "string") {
      body = Buffer.from(req.body, "utf8");
    } else if (req.body && typeof req.body === "object") {
      body = Buffer.from(JSON.stringify(req.body), "utf8");
    }
  }

  return new Request(fullUrl, {
    method,
    headers,
    body,
  });
}

export default async function gateway(context, req, customEnv = null) {
  try {
    const baseEnv = customEnv || process.env;
    const env = {
      ...baseEnv,
      DB: baseEnv.DB || createPgDb(baseEnv),
      BUCKET: baseEnv.BUCKET || createBlobBucket(baseEnv),
    };

    const fetchReq = buildFetchRequest(req, context);
    const response = await api(fetchReq, env);

    const outHeaders = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-length") return;
      outHeaders[key] = value;
    });

    let cookies = [];
    if (typeof response.headers.getSetCookie === "function") {
      cookies = response.headers.getSetCookie();
    } else {
      const rawCookie = response.headers.get("set-cookie");
      if (rawCookie) cookies = [rawCookie];
    }
    if (cookies.length) {
      outHeaders["Set-Cookie"] = cookies[cookies.length - 1];
    }

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isTextBody =
      contentType.includes("application/json") || contentType.startsWith("text/");

    context.res = {
      status: response.status,
      headers: outHeaders,
      body: isTextBody ? bodyBuffer.toString("utf8") : bodyBuffer,
    };
  } catch (err) {
    if (context?.log?.error) {
      context.log.error("Gateway unhandled exception:", err);
    }
    context.res = {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        error: "The request could not be completed. Please try again.",
      }),
    };
  }
}
