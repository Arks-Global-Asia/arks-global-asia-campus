import { api } from "../../server/api.js";
import { PostgresDatabase } from "../../azure/portal/postgres-database.js";
import { AzureBlobBucket } from "../../azure/portal/blob-storage.js";
let environment;
export function portalEnvironment(settings = process.env) {
  const env = { ...settings, AUTH_MODE: settings.AUTH_MODE || "entra" };
  if (!["entra", "google"].includes(env.AUTH_MODE))
    throw Object.assign(
      Error("Configure a supported institute authentication provider."),
      { status: 503 },
    );
  env.DB = new PostgresDatabase(env);
  env.BUCKET = new AzureBlobBucket(env);
  env.PORTAL_READY = !!(
    env.PORTAL_PG_HOST &&
    env.PORTAL_PG_DATABASE &&
    env.PORTAL_PG_USER &&
    env.PORTAL_PG_PASSWORD &&
    (env.PORTAL_BLOB_CONNECTION_STRING || env.PORTAL_BLOB_ACCOUNT) &&
    env.APP_ORIGIN
  );
  return env;
}
export async function handleAzureRequest(azureRequest, settings, overrideEnv) {
  try {
    const env =
      overrideEnv ||
      (settings
        ? portalEnvironment(settings)
        : (environment ||= portalEnvironment()));
    const headers = new Headers(azureRequest.headers);
    // Never accept the old host's identity adapter on a public Azure endpoint.
    for (const key of [...headers.keys()])
      if (key.toLowerCase().startsWith("oai-authenticated-"))
        headers.delete(key);
    // The public origin is operator configured; client-supplied forwarded hosts are ignored.
    const raw = new URL(azureRequest.url),
      origin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : raw.origin;
    const url = new URL(raw.pathname + raw.search, origin);
    if (url.pathname === "/api/health")
      return {
        status: env.PORTAL_READY ? 200 : 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({
          ok: env.PORTAL_READY,
          service: "arks-campus-api",
          configured: env.PORTAL_READY,
        }),
      };
    if (!env.PORTAL_READY && url.pathname !== "/api/auth/config")
      return {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({
          error:
            "The institute is completing campus service setup. Please contact support.",
          code: "PORTAL_NOT_CONFIGURED",
        }),
      };
    const method = azureRequest.method.toUpperCase();
    let bytes;
    if (!["GET", "HEAD"].includes(method)) {
      const announced = Number(headers.get("content-length") || 0);
      if (announced > 21 * 1024 * 1024)
        throw Object.assign(Error("Choose an upload of 20 MB or less."), {
          status: 413,
        });
      bytes = await azureRequest.arrayBuffer();
      if (bytes.byteLength > 21 * 1024 * 1024)
        throw Object.assign(Error("Choose an upload of 20 MB or less."), {
          status: 413,
        });
    }
    const req = new Request(url, { method, headers, body: bytes });
    const response = await api(req, env);
    const outHeaders = Object.fromEntries(response.headers);
    outHeaders["X-Content-Type-Options"] = "nosniff";
    outHeaders["Cache-Control"] ||= "no-store";
    return {
      status: response.status,
      headers: outHeaders,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (e) {
    return {
      status: e.status || 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        error: e.status
          ? e.message
          : "The campus service could not be reached. Please retry or contact support.",
      }),
    };
  }
}
