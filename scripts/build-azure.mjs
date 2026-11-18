import { build } from "esbuild";
import fs from "node:fs/promises";
await fs.mkdir("api/dist", { recursive: true });
await build({
  entryPoints: ["api/src/index.js"],
  outfile: "api/dist/index.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
});
console.log("Built Azure managed API at api/dist/index.js");
