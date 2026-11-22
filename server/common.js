export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const one = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .first();
export const rows = async (db, q, ...v) =>
  (
    await db
      .prepare(q)
      .bind(...v)
      .all()
  ).results;
export const run = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .run();
export const json = (v, status = 200, headers = {}) =>
  Response.json(v, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

export const isStaff = (u) =>
  Boolean(u && (u.role === "admin" || u.role === "trainer"));

export const staff = (u) => {
  if (!isStaff(u)) fail(403, "Instructor or administrator access required.");
};

export const admin = (u) => {
  if (!u || u.role !== "admin") fail(403, "Administrator access required.");
};

export async function member(db, u, id) {
  const b = await one(db, "SELECT * FROM batches WHERE id=?", id);
  if (!b) fail(404, "Batch not found.");
  if (
    !isStaff(u) &&
    !(await one(
      db,
      "SELECT id FROM enrollments WHERE user_id=? AND batch_id=?",
      u.id,
      id,
    ))
  )
    fail(403, "Batch access denied.");
  if (!isStaff(u) && JSON.parse(b.config || "{}").require_google_group) {
    const membership = await one(
      db,
      "SELECT g.id FROM access_groups g JOIN group_members m ON m.group_id=g.id WHERE g.batch_id=? AND m.email=?",
      id,
      u.email,
    );
    if (!membership) fail(403, "Group membership is required for this batch.");
  }
  return b;
}

export const hash = async (s) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

export function https(value) {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol === "https:") return u.href;
  } catch {}
  fail(400, "Use an HTTPS URL.");
}

const BUILTIN_ALLOWED_ORIGINS = new Set([
  "https://student-portal.arksglobalasia.cloud",
  "https://yellow-tree-0ceb4a400.3.azurestaticapps.net",
]);

function normalizeOrigin(raw) {
  if (!raw || typeof raw !== "string") return "";
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return u.origin;
  } catch {
    return "";
  }
}

function originFromHostHeader(hostHeader, fallbackProtocol = "https:") {
  if (!hostHeader || typeof hostHeader !== "string") return "";
  const host = hostHeader.split(",")[0].trim();
  if (!host || /[^a-zA-Z0-9.:-]/.test(host)) return "";
  const isLocal =
    host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = isLocal ? "http:" : fallbackProtocol;
  return normalizeOrigin(`${proto}//${host}`);
}

export function isAllowedOrigin(originStr, req, env = {}) {
  const candidate = normalizeOrigin(originStr);
  if (!candidate) return false;
  if (BUILTIN_ALLOWED_ORIGINS.has(candidate)) return true;

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol === "https:" &&
      (parsed.hostname === "arksglobalasia.cloud" ||
        parsed.hostname.endsWith(".arksglobalasia.cloud") ||
        parsed.hostname.endsWith(".azurestaticapps.net"))
    ) {
      return true;
    }
    if (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      (parsed.protocol === "http:" || parsed.protocol === "https:")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  const dynamicList = [
    env?.PUBLIC_ORIGIN || "",
    ...(String(env?.ALLOWED_ORIGINS || "").split(",")),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
  if (dynamicList.includes(candidate)) return true;

  if (req) {
    try {
      const reqUrl = new URL(req.url);
      if (candidate === reqUrl.origin) return true;
      const fwdProto =
        req.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
        reqUrl.protocol.replace(":", "");
      const proto = fwdProto === "http" ? "http:" : "https:";
      const xfh = originFromHostHeader(
        req.headers?.get("x-forwarded-host"),
        proto,
      );
      if (xfh && candidate === xfh) return true;
      const xoh = originFromHostHeader(
        req.headers?.get("x-original-host"),
        proto,
      );
      if (xoh && candidate === xoh) return true;
    } catch {}
  }
  return false;
}

export function verifyOrigin(req, env = {}) {
  if (!req || req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers?.get("Origin");
  if (origin && !isAllowedOrigin(origin, req, env)) {
    fail(403, "Invalid request origin.");
  }
}

export function resolvePublicOrigin(req, env = {}) {
  const reqUrl = new URL(req.url);
  const fwdProto =
    req.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    reqUrl.protocol.replace(":", "");
  const proto = fwdProto === "http" ? "http:" : "https:";

  const candidates = [
    originFromHostHeader(req.headers?.get("x-forwarded-host"), proto),
    originFromHostHeader(req.headers?.get("x-original-host"), proto),
    normalizeOrigin(req.headers?.get("Origin")),
    normalizeOrigin(env?.PUBLIC_ORIGIN),
    reqUrl.origin,
  ].filter(Boolean);

  for (const c of candidates) {
    if (isAllowedOrigin(c, req, env)) return c;
  }
  return reqUrl.origin;
}

export function clientIp(req) {
  if (!req?.headers) return "unknown";
  const cf = req.headers.get("CF-Connecting-IP");
  if (cf && cf.trim()) return cf.trim();
  const xc = req.headers.get("X-Client-IP");
  if (xc && xc.trim()) return xc.trim();
  const xff = req.headers.get("X-Forwarded-For");
  if (xff && xff.trim()) return xff.split(",")[0].trim();
  return "unknown";
}

export function istDateInfo(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  const valid = isNaN(d.getTime()) ? new Date() : d;
  // IST is UTC + 05:30 (330 minutes)
  const istMs = valid.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const dateKey = `${year}-${month}-${day}`;
  const dayOfWeek = ist.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const hour = ist.getUTCHours();

  // Compute previous day in IST
  const prevIst = new Date(istMs - 24 * 3600 * 1000);
  const prevDateKey = `${prevIst.getUTCFullYear()}-${String(prevIst.getUTCMonth() + 1).padStart(2, "0")}-${String(prevIst.getUTCDate()).padStart(2, "0")}`;

  // Compute Monday of the current week in IST (if Sunday, Monday was 6 days ago; otherwise dayOfWeek - 1 days ago)
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monIst = new Date(istMs - daysSinceMonday * 24 * 3600 * 1000);
  const weekMondayKey = `${monIst.getUTCFullYear()}-${String(monIst.getUTCMonth() + 1).padStart(2, "0")}-${String(monIst.getUTCDate()).padStart(2, "0")}`;
  const satIst = new Date(monIst.getTime() + 5 * 24 * 3600 * 1000);
  const weekSaturdayKey = `${satIst.getUTCFullYear()}-${String(satIst.getUTCMonth() + 1).padStart(2, "0")}-${String(satIst.getUTCDate()).padStart(2, "0")}`;

  // ISO timestamps in UTC corresponding to Monday 00:00:00 IST and Saturday 23:59:59.999 IST
  const mondayStartUtc = new Date(
    Date.UTC(
      monIst.getUTCFullYear(),
      monIst.getUTCMonth(),
      monIst.getUTCDate(),
      0,
      0,
      0,
      0,
    ) -
      330 * 60 * 1000,
  ).toISOString();
  const saturdayEndUtc = new Date(
    Date.UTC(
      satIst.getUTCFullYear(),
      satIst.getUTCMonth(),
      satIst.getUTCDate(),
      23,
      59,
      59,
      999,
    ) -
      330 * 60 * 1000,
  ).toISOString();

  return {
    dateKey,
    prevDateKey,
    dayOfWeek,
    hour,
    weekMondayKey,
    weekSaturdayKey,
    mondayStartUtc,
    saturdayEndUtc,
  };
}
