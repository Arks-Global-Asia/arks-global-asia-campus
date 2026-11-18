import { createRemoteJWKSet, jwtVerify } from "jose";
import { one, rows, run, uid, now, fail, json, hash } from "./common.js";
import { session, getCookie } from "./auth.js";
const caches = new Map(),
  keysets = new Map();
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function entraReady(env) {
  return !!(
    GUID.test(env.ENTRA_TENANT_ID || "") &&
    GUID.test(env.ENTRA_CLIENT_ID || "") &&
    /^[a-z0-9-]+$/i.test(env.ENTRA_TENANT_SUBDOMAIN || "") &&
    env.ENTRA_CLIENT_SECRET &&
    env.APP_ORIGIN
  );
}
function config(env) {
  if (!entraReady(env))
    fail(503, "Institute sign-in is awaiting configuration.");
  const origin = new URL(env.APP_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    fail(503, "Institute sign-in origin is invalid.");
  return {
    tenant: env.ENTRA_TENANT_ID.toLowerCase(),
    client: env.ENTRA_CLIENT_ID,
    host: env.ENTRA_TENANT_SUBDOMAIN.toLowerCase() + ".ciamlogin.com",
    origin: origin.origin,
    redirect: origin.origin + "/api/auth/entra/callback",
  };
}
function trustedEndpoint(value, c) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      [
        c.host,
        c.tenant + ".ciamlogin.com",
        "login.microsoftonline.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
async function discovery(c) {
  const key = c.host + "/" + c.tenant;
  const old = caches.get(key);
  if (old && old.expires > Date.now()) return old.value;
  let r;
  try {
    r = await fetch(
      "https://" +
        c.host +
        "/" +
        c.tenant +
        "/v2.0/.well-known/openid-configuration",
      { redirect: "error", signal: AbortSignal.timeout(8000) },
    );
  } catch {
    fail(503, "Institute sign-in could not be reached. Please retry.");
  }
  if (!r.ok) fail(503, "Institute sign-in configuration could not be read.");
  const d = await r.json();
  if (
    !trustedEndpoint(d.authorization_endpoint, c) ||
    !trustedEndpoint(d.token_endpoint, c) ||
    !trustedEndpoint(d.jwks_uri, c) ||
    !trustedEndpoint(d.issuer, c) ||
    !new URL(d.issuer).pathname.toLowerCase().includes("/" + c.tenant + "/")
  )
    fail(503, "Institute identity metadata is invalid.");
  caches.set(key, { value: d, expires: Date.now() + 3600000 });
  return d;
}
function base64url(data) {
  let bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
const stateCookie = (state, age = 600) =>
  `arks_entra=${state}; Path=/api/auth/entra; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
export async function resolveEntraIdentity(db, claims, issuer) {
  const subject = String(claims.sub || "");
  if (!subject || subject.length > 200)
    fail(401, "Institute identity has no valid subject.");
  const identity = await hash(issuer + "\n" + subject);
  const binding = await one(
    db,
    "SELECT u.* FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.id=? AND i.issuer=? AND i.subject=?",
    identity,
    issuer,
    subject,
  );
  if (binding) {
    if (!binding.active) fail(403, "Your account is disabled.");
    return binding;
  }
  // Tenant-validated email may redeem an explicit student invitation. Existing admin
  // accounts require a prebound subject; email alone never links an admin identity.
  const email = String(
    claims.email ||
      (Array.isArray(claims.emails) ? claims.emails[0] : "") ||
      "",
  )
    .trim()
    .toLowerCase();
  if (
    claims.email_verified === false ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    fail(
      403,
      "Your institute needs a verified email claim to match your enrollment.",
    );
  const invites = await rows(
      db,
      "SELECT * FROM invitations WHERE email=?",
      email,
    ),
    groups = await rows(
      db,
      "SELECT g.* FROM access_groups g JOIN group_members m ON m.group_id=g.id WHERE m.email=?",
      email,
    );
  if (!invites.length && !groups.length)
    fail(403, "Your administrator has not enrolled this email.");
  let u = await one(db, "SELECT * FROM users WHERE email=?", email);
  if (u && !u.active) fail(403, "Your account is disabled.");
  if (u?.role === "admin")
    fail(
      403,
      "This administrator identity needs explicit linking. Use administrator password sign-in.",
    );
  if (!u) {
    u = {
      id: uid(),
      email,
      name: String(claims.name || email.split("@")[0]).slice(0, 100),
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
  await run(
    db,
    "INSERT INTO auth_identities(id,issuer,subject,user_id) VALUES (?,?,?,?)",
    identity,
    issuer,
    subject,
    u.id,
  );
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
  return await one(db, "SELECT * FROM users WHERE id=?", u.id);
}
export async function entraRoutes(req, env) {
  const path = new URL(req.url).pathname;
  if (!path.startsWith("/api/auth/entra/")) return null;
  if (req.method !== "GET") fail(405, "Use a browser sign-in request.");
  const c = config(env),
    db = env.DB;
  if (path === "/api/auth/entra/start") {
    const d = await discovery(c),
      state = uid() + uid(),
      nonce = uid(),
      verifier = base64url(crypto.getRandomValues(new Uint8Array(48))),
      challenge = base64url(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      );
    await run(
      db,
      "INSERT INTO auth_states VALUES (?,?,?)",
      await hash(state),
      JSON.stringify({ nonce, verifier, redirect: c.redirect }),
      new Date(Date.now() + 600000).toISOString(),
    );
    const dest = new URL(d.authorization_endpoint);
    dest.search = new URLSearchParams({
      client_id: c.client,
      response_type: "code",
      redirect_uri: c.redirect,
      response_mode: "query",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest.href,
        "Set-Cookie": stateCookie(state),
        "Cache-Control": "no-store",
      },
    });
  }
  if (path === "/api/auth/entra/callback") {
    // Return a safe, friendly login message for browser navigation errors.
    try {
      const p = new URL(req.url).searchParams,
        state = p.get("state");
      if (!state || state !== getCookie(req, "arks_entra"))
        fail(403, "Sign-in state is invalid. Start again.");
      const saved = await one(
        db,
        "SELECT * FROM auth_states WHERE id=? AND expires>?",
        await hash(state),
        now(),
      );
      if (!saved) fail(403, "Sign-in has expired. Start again.");
      const consumed = await run(
        db,
        "DELETE FROM auth_states WHERE id=?",
        saved.id,
      );
      if (!consumed.meta?.changes)
        fail(403, "This sign-in response was already used.");
      if (p.has("error") || !p.get("code"))
        fail(401, "Sign-in was cancelled or refused.");
      const flow = JSON.parse(saved.verifier);
      if (flow.redirect !== c.redirect)
        fail(403, "The sign-in address changed. Start again.");
      const d = await discovery(c);
      let r;
      try {
        r = await fetch(d.token_endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({
            client_id: c.client,
            client_secret: env.ENTRA_CLIENT_SECRET,
            grant_type: "authorization_code",
            code: p.get("code"),
            redirect_uri: c.redirect,
            code_verifier: flow.verifier,
          }),
        });
      } catch {
        fail(503, "Institute sign-in could not be completed. Please retry.");
      }
      if (!r.ok) fail(401, "Institute sign-in could not be completed.");
      const tokens = await r.json();
      let claims;
      try {
        if (!keysets.has(d.jwks_uri))
          keysets.set(d.jwks_uri, createRemoteJWKSet(new URL(d.jwks_uri)));
        claims = (
          await jwtVerify(tokens.id_token, keysets.get(d.jwks_uri), {
            issuer: d.issuer,
            audience: c.client,
            algorithms: ["RS256"],
            clockTolerance: 5,
          })
        ).payload;
      } catch {
        fail(401, "Institute identity could not be verified.");
      }
      if (
        typeof claims.exp !== "number" ||
        claims.nonce !== flow.nonce ||
        String(claims.tid || "").toLowerCase() !== c.tenant
      )
        fail(403, "Institute identity does not match this sign-in.");
      const u = await resolveEntraIdentity(db, claims, d.issuer);
      return new Response(null, {
        status: 302,
        headers: {
          Location: c.origin + "/",
          "Set-Cookie": await session(db, u),
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      const message = e.status
        ? e.message
        : "Institute sign-in could not be completed. Please contact support.";
      return new Response(null, {
        status: 302,
        headers: {
          Location: c.origin + "/?auth_error=" + encodeURIComponent(message),
          "Set-Cookie": stateCookie("", 0),
          "Cache-Control": "no-store",
        },
      });
    }
  }
  fail(404, "Sign-in endpoint not found.");
}
