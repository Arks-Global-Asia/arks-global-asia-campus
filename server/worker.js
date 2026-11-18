import { api } from "./api.js";
const assets = __ASSETS__;
const types = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  css: "text/css",
  png: "image/png",
  svg: "image/svg+xml",
  webmanifest: "application/manifest+json",
  md: "text/plain; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
};
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    let res;
    if (pathname.startsWith("/api/")) res = await api(request, env);
    else {
      const key = assets[pathname]
        ? pathname
        : pathname === "/"
          ? "/index.html"
          : null;
      if (!key) return new Response("Not found", { status: 404 });
      const bytes = Uint8Array.from(atob(assets[key]), (c) => c.charCodeAt(0));
      res = new Response(bytes, {
        headers: {
          "Content-Type":
            types[key.split(".").pop()] || "application/octet-stream",
          "Cache-Control": key.includes("/assets/")
            ? "public,max-age=31536000,immutable"
            : "no-cache",
        },
      });
    }
    const h = new Headers(res.headers);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    h.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
    return new Response(res.body, { status: res.status, headers: h });
  },
};
