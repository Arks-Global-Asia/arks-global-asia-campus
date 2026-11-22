import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  one,
  rows,
  run,
  uid,
  now,
  fail,
  json,
  hash,
  admin,
  isStaff,
  resolvePublicOrigin,
  clientIp,
} from "./common.js";
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const cookie = (value, age = 28800) =>
  `arks_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const getCookie = (r, name) =>
  r.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
async function passwordHash(password, salt) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: new TextEncoder().encode(salt),
          iterations: 100000,
        },
        k,
        256,
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function session(db, user) {
  const raw = uid() + uid();
  await run(
    db,
    "INSERT INTO auth_sessions VALUES (?,?,?)",
    await hash(raw),
    user.id,
    new Date(Date.now() + 8 * 3600000).toISOString(),
  );
  return cookie(raw);
}
export async function sessionUser(req, env) {
  const token = getCookie(req, "arks_session");
  if (!token) return null;
  const u = await one(
    env.DB,
    "SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.id=? AND s.expires>?",
    await hash(token),
    now(),
  );
  if (!u || !u.active) return null;
  return u;
}
export async function authRoutes(req, env) {
  const p = new URL(req.url).pathname,
    db = env.DB;
  if (p === "/api/auth/config")
    return json({
      google_ready: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      mode: env.AUTH_MODE || "google",
      public_origin: resolvePublicOrigin(req, env),
    });
  if (p === "/api/auth/logout" && req.method === "POST") {
    const t = getCookie(req, "arks_session");
    if (t) await run(db, "DELETE FROM auth_sessions WHERE id=?", await hash(t));
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (p === "/api/auth/admin" && req.method === "POST") {
    const d = await req.json(),
      email = String(d.email || "")
        .trim()
        .toLowerCase(),
      password = String(d.password || "");
    if (password.length > 256) fail(400, "Invalid credentials.");
    const key = await hash(email + ":" + clientIp(req)),
      time = Date.now();
    await run(
      db,
      "INSERT INTO auth_limits VALUES (?,0,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 0 ELSE attempts END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
      key,
      time + 15 * 60000,
      time,
      time,
    );
    await run(db, "UPDATE auth_limits SET attempts=attempts+1 WHERE id=?", key);
    if (
      (await one(db, "SELECT attempts FROM auth_limits WHERE id=?", key))
        .attempts > 8
    )
      fail(429, "Too many login attempts. Try again in 15 minutes.");
    const u = await one(
      db,
      "SELECT u.*,c.salt,c.password_hash FROM users u JOIN admin_credentials c ON c.user_id=u.id WHERE lower(u.email)=? AND u.active=1 AND u.role IN ('admin','trainer')",
      email,
    );
    const actual = await passwordHash(
      password,
      u?.salt || "invalid-account-constant-salt",
    );
    if (!u || actual !== u.password_hash)
      fail(401, "Email or password is incorrect.");
    await run(db, "DELETE FROM auth_limits WHERE id=?", key);
    return json({ ok: true, role: u.role }, 200, {
      "Set-Cookie": await session(db, u),
    });
  }
  if (p === "/api/auth/google/start") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
      fail(503, "Google sign-in has not been configured yet.");
    const state = uid() + uid(),
      nonce = uid();
    await run(
      db,
      "INSERT INTO auth_states VALUES (?,?,?)",
      await hash(state),
      nonce,
      new Date(Date.now() + 600000).toISOString(),
    );
    const pubOrigin = resolvePublicOrigin(req, env);
    const dest = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    dest.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: new URL("/api/auth/google/callback", pubOrigin).href,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      prompt: "select_account",
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest.href,
        "Set-Cookie": `arks_oauth=${state}; Path=/api/auth/google; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
    });
  }
  if (p === "/api/auth/google/callback") {
    const params = new URL(req.url).searchParams,
      state = params.get("state");
    if (!state || state !== getCookie(req, "arks_oauth"))
      fail(403, "Sign-in state is invalid. Start again.");
    const saved = await one(
      db,
      "SELECT * FROM auth_states WHERE id=? AND expires>?",
      await hash(state),
      now(),
    );
    if (!saved) fail(403, "Sign-in expired.");
    await run(db, "DELETE FROM auth_states WHERE id=?", saved.id);
    const pubOrigin = resolvePublicOrigin(req, env);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code: params.get("code") || "",
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: new URL("/api/auth/google/callback", pubOrigin).href,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) fail(401, "Google sign-in could not be completed.");
    const tokens = await r.json();
    let claims;
    try {
      claims = (
        await jwtVerify(tokens.id_token, jwks, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: env.GOOGLE_CLIENT_ID,
        })
      ).payload;
    } catch {
      fail(401, "Google identity could not be verified.");
    }
    if (claims.nonce !== saved.verifier || claims.email_verified !== true)
      fail(403, "A verified Google email is required.");
    const email = String(claims.email).toLowerCase(),
      invites = await rows(
        db,
        "SELECT * FROM invitations WHERE email=?",
        email,
      ),
      groups = await rows(
        db,
        "SELECT g.* FROM access_groups g JOIN group_members m ON m.group_id=g.id WHERE m.email=?",
        email,
      );
    let u = await one(db, "SELECT * FROM users WHERE email=?", email);
    if (u && !u.active) fail(403, "Your account is disabled.");
    if (!invites.length && !groups.length && !isStaff(u))
      fail(403, "Your administrator has not granted access to this email.");
    if (!u) {
      u = {
        id: uid(),
        email,
        name: claims.name || email.split("@")[0],
        role: "student",
      };
      await run(
        db,
        "INSERT INTO users(id,email,name,role,created) VALUES (?,?,?,'student',?)",
        u.id,
        email,
        u.name,
        now(),
      );
    }
    for (const v of [...invites, ...groups])
      await run(
        db,
        "INSERT OR IGNORE INTO enrollments(id,user_id,batch_id,fee,created) VALUES (?,?,?,?,?)",
        uid(),
        u.id,
        v.batch_id,
        v.fee || 0,
        now(),
      );
    // Local invitations can explicitly grant admin or trainer; remote group membership never grants staff roles.
    if (invites.some((i) => i.role === "admin"))
      await run(db, "UPDATE users SET role='admin' WHERE id=?", u.id);
    else if (invites.some((i) => i.role === "trainer") && u.role !== "admin")
      await run(db, "UPDATE users SET role='trainer' WHERE id=?", u.id);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": await session(db, u),
        "Cache-Control": "no-store",
      },
    });
  }
  return null;
}
export async function setAdminPassword(db, u, d) {
  admin(u);
  if (
    typeof d.password !== "string" ||
    d.password.length < 14 ||
    d.password.length > 256
  )
    fail(400, "Use a password of 14–256 characters.");
  const email = String(d.email || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter an email.");
  const requestedRole = d.role === "trainer" ? "trainer" : "admin";
  let target = await one(db, "SELECT * FROM users WHERE email=?", email);
  if (!target) {
    target = { id: uid(), role: requestedRole };
    await run(
      db,
      "INSERT INTO users(id,email,name,role,created) VALUES (?,?,?,?,?)",
      target.id,
      email,
      d.name || email.split("@")[0],
      requestedRole,
      now(),
    );
  }
  const finalRole = d.role
    ? requestedRole
    : target.role === "trainer"
      ? "trainer"
      : "admin";
  await run(
    db,
    "UPDATE users SET role=?,name=COALESCE(NULLIF(?,''),name),active=1 WHERE id=?",
    finalRole,
    String(d.name || "").trim(),
    target.id,
  );
  const salt = uid() + uid();
  await run(
    db,
    "INSERT INTO admin_credentials VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash",
    target.id,
    salt,
    await passwordHash(d.password, salt),
  );
  await run(db, "DELETE FROM auth_sessions WHERE user_id=?", target.id);
  return json({ ok: true, role: finalRole });
}
