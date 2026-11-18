import test from "node:test";
import assert from "node:assert/strict";
import { database, memoryBucket } from "../scripts/database.mjs";
import { api } from "../server/api.js";
import { compilePostgres } from "../azure/portal/postgres-compiler.js";
import { handleAzureRequest, portalEnvironment } from "../api/src/handler.js";
import { readApiResponse } from "../shared/http.js";
import { resolveEntraIdentity } from "../server/entra.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
const tenant = "0c218ee7-11fe-4714-962d-ba5efb884bc2",
  client = "38f7e4ae-291c-4aa3-b8b0-72a28242e01f";
async function fixture() {
  const env = {
    DB: await database(),
    BUCKET: memoryBucket(),
    PORTAL_READY: true,
  };
  const headers = {
    "oai-authenticated-user-id": "owner",
    "oai-authenticated-user-email": "owner@arks.test",
  };
  await api(new Request("https://campus.test/api/bootstrap", { headers }), env);
  return env;
}
test("HTML API fallback becomes a friendly service error without a JSON parser exception", async () => {
  await assert.rejects(
    readApiResponse(
      new Response("<!DOCTYPE html><html></html>", {
        headers: { "content-type": "text/html" },
      }),
    ),
    (e) => e.status === 503 && !e.message.includes("Unexpected token"),
  );
  assert.deepEqual(await readApiResponse(Response.json({ ok: true })), {
    ok: true,
  });
});
test("Azure adapter exposes JSON readiness and never trusts old host identity headers", async () => {
  const env = await fixture();
  env.AUTH_MODE = "entra";
  env.APP_ORIGIN = "https://campus.test";
  const req = new Request("https://internal.invalid/api/bootstrap", {
    headers: {
      "oai-authenticated-user-id": "owner",
      "oai-authenticated-user-email": "owner@arks.test",
    },
  });
  const r = await handleAzureRequest(req, undefined, env);
  assert.equal(r.status, 401);
  env.PORTAL_READY = false;
  const missing = await handleAzureRequest(
    new Request("https://internal.invalid/api/bootstrap"),
    undefined,
    env,
  );
  assert.equal(missing.status, 503);
  assert.equal(JSON.parse(missing.body).code, "PORTAL_NOT_CONFIGURED");
  const cfg = await handleAzureRequest(
    new Request("https://internal.invalid/api/auth/config"),
    undefined,
    env,
  );
  assert.equal(cfg.status, 200);
  assert.equal(
    JSON.parse(new TextDecoder().decode(cfg.body)).portal_ready,
    false,
  );
  assert.throws(() => portalEnvironment({ AUTH_MODE: "sites" }));
});
test("PostgreSQL compiler binds values and translates ignore inserts", () => {
  const q = compilePostgres(
    "INSERT OR IGNORE INTO settings (key,value) VALUES ('owner',?)",
    ["id"],
  );
  assert.match(q.text, /ON CONFLICT DO NOTHING$/);
  assert.match(q.text, /\$1/);
  assert.equal(q.values[0], "id");
  const value = "'; DROP TABLE users; --";
  assert.ok(
    !compilePostgres("SELECT * FROM users WHERE email=?", [
      value,
    ]).text.includes(value),
  );
  assert.throws(() => compilePostgres("SELECT * FROM users WHERE id=?", []));
});

test("Entra enrollment redeems student invitations and binds subjects without granting admin by email", async () => {
  const env = await fixture(),
    db = env.DB;
  await db
    .prepare(
      "INSERT INTO invitations(id,email,batch_id,role,fee) VALUES ('i','student@arks.test','sandbox','student',12300)",
    )
    .run();
  const claims = {
    sub: "subject-1",
    email: "student@arks.test",
    name: "Student",
  };
  const u = await resolveEntraIdentity(db, claims, "https://issuer");
  assert.equal(u.role, "student");
  assert.equal(
    (
      await db
        .prepare("SELECT fee FROM enrollments WHERE user_id=?")
        .bind(u.id)
        .first()
    ).fee,
    12300,
  );
  assert.equal(
    (await resolveEntraIdentity(db, claims, "https://issuer")).id,
    u.id,
  );
  await assert.rejects(
    resolveEntraIdentity(
      db,
      { sub: "unknown", email: "unknown@arks.test" },
      "https://issuer",
    ),
    (e) => e.status === 403,
  );
  await db
    .prepare(
      "INSERT INTO invitations(id,email,batch_id,role,fee) VALUES ('a','owner@arks.test','sandbox','admin',0)",
    )
    .run();
  await assert.rejects(
    resolveEntraIdentity(
      db,
      { sub: "admin-subject", email: "owner@arks.test" },
      "https://issuer",
    ),
    (e) => e.status === 403,
  );
});
let sequence = 0;
async function flowCase(t, modify) {
  const env = await fixture();
  env.AUTH_MODE = "entra";
  Object.assign(env, {
    ENTRA_TENANT_ID: tenant,
    ENTRA_CLIENT_ID: client,
    ENTRA_TENANT_SUBDOMAIN: "arks-test-" + ++sequence,
    ENTRA_CLIENT_SECRET: "fixture-only",
    APP_ORIGIN: "https://campus.test",
  });
  await env.DB.prepare(
    "INSERT INTO invitations(id,email,batch_id,role,fee) VALUES ('i','student@arks.test','sandbox','student',0)",
  ).run();
  const host = env.ENTRA_TENANT_SUBDOMAIN + ".ciamlogin.com",
    issuer = "https://" + host + "/" + tenant + "/v2.0",
    d = {
      authorization_endpoint:
        "https://" + host + "/" + tenant + "/oauth2/v2.0/authorize",
      token_endpoint: "https://" + host + "/" + tenant + "/oauth2/v2.0/token",
      jwks_uri: "https://" + host + "/" + tenant + "/keys",
      issuer,
    };
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "fixture";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const original = globalThis.fetch;
  let nonce, tokenBody;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("openid-configuration")) return Response.json(d);
    if (u === d.jwks_uri) return Response.json({ keys: [jwk] });
    if (u === d.token_endpoint) {
      tokenBody = options.body;
      const payload = {
        sub: "student-subject",
        tid: tenant,
        email: "student@arks.test",
        nonce,
        ...modify?.claims,
      };
      let token = await new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: "fixture" })
        .setIssuer(issuer)
        .setAudience(modify?.audience || client)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ id_token: token });
    }
    throw Error("Unexpected network request");
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const start = await api(
    new Request("https://campus.test/api/auth/entra/start"),
    env,
  );
  assert.equal(start.status, 302);
  const url = new URL(start.headers.get("location"));
  nonce = url.searchParams.get("nonce");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://campus.test/api/auth/entra/callback",
  );
  const state = url.searchParams.get("state"),
    cookie = start.headers.get("set-cookie").split(";")[0];
  const callback = () =>
    api(
      new Request(
        "https://campus.test/api/auth/entra/callback?code=fixture&state=" +
          state,
        { headers: { cookie } },
      ),
      env,
    );
  const result = await callback();
  assert.equal(result.status, 302);
  if (modify) {
    assert.match(result.headers.get("location"), /auth_error=/);
    assert.ok(!result.headers.get("set-cookie").startsWith("arks_session="));
  } else {
    assert.equal(result.headers.get("location"), "https://campus.test/");
    assert.match(result.headers.get("set-cookie"), /^arks_session=/);
    assert.ok(tokenBody.get("code_verifier"));
    const session = result.headers.get("set-cookie").split(";")[0];
    const boot = await api(
      new Request("https://campus.test/api/bootstrap", {
        headers: { cookie: session },
      }),
      env,
    );
    assert.equal(boot.status, 200);
    assert.equal((await boot.json()).user.role, "student");
  }
  assert.match((await callback()).headers.get("location"), /auth_error=/);
}
test("Entra code/PKCE callback verifies the signed identity and rejects replay", (t) =>
  flowCase(t));
test("Entra callback rejects a signed token for another audience", (t) =>
  flowCase(t, { audience: "another-app" }));
test("Entra callback rejects a signed token with the wrong nonce", (t) =>
  flowCase(t, { claims: { nonce: "wrong" } }));

test("one central identity enrolls in multiple batches without duplicate user profiles", async () => {
  const env = await fixture(),
    db = env.DB;
  await db
    .prepare(
      "INSERT INTO batches(id,course_id,name,start_date,end_date) VALUES ('next','devops','Next batch','2026-12-01','2027-02-01')",
    )
    .run();
  for (const [id, batch] of [
    ["i1", "sandbox"],
    ["i2", "next"],
  ])
    await db
      .prepare(
        "INSERT INTO invitations(id,email,batch_id,role,fee) VALUES (?,? ,?,'student',10000)",
      )
      .bind(id, "central@arks.test", batch)
      .run();
  const claims = {
    sub: "central-subject",
    email: "central@arks.test",
    name: "Central student",
  };
  const a = await resolveEntraIdentity(db, claims, "https://issuer"),
    b = await resolveEntraIdentity(db, claims, "https://issuer");
  assert.equal(a.id, b.id);
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM users WHERE email=?")
        .bind(claims.email)
        .first()
    ).n,
    1,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM enrollments WHERE user_id=?")
        .bind(a.id)
        .first()
    ).n,
    2,
  );
});

test("Entra callback rejects a signed token from another tenant", (t) =>
  flowCase(t, { claims: { tid: "11111111-1111-1111-1111-111111111111" } }));
test("Entra mode cannot be bypassed with the direct Google endpoint", async () => {
  const env = await fixture();
  env.AUTH_MODE = "entra";
  const r = await api(
    new Request("https://campus.test/api/auth/google/start"),
    env,
  );
  assert.equal(r.status, 404);
});
