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
export async function member(db, u, id) {
  const b = await one(db, "SELECT * FROM batches WHERE id=?", id);
  if (!b) fail(404, "Batch not found.");
  if (
    u.role !== "admin" &&
    !(await one(
      db,
      "SELECT id FROM enrollments WHERE user_id=? AND batch_id=?",
      u.id,
      id,
    ))
  )
    fail(403, "Batch access denied.");
  if (u.role !== "admin" && JSON.parse(b.config || "{}").require_google_group) {
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
export const admin = (u) => {
  if (u.role !== "admin") fail(403, "Administrator access required.");
};
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
