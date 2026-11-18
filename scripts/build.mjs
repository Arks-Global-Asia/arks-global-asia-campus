import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const assets = {};
async function collect(dir, prefix = "") {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const loc = path.join(dir, entry.name),
      key = prefix + "/" + entry.name;
    if (entry.isDirectory()) await collect(loc, key);
    else assets[key] = (await fs.readFile(loc)).toString("base64");
  }
}
await collect("dist/client");
await fs.mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["server/worker.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/server/index.js",
  define: { __ASSETS__: JSON.stringify(assets) },
});
await fs.mkdir("dist/.openai", { recursive: true });
await fs.copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await fs.cp("drizzle", "dist/drizzle", { recursive: true });
console.log(
  "Built Worker with " + Object.keys(assets).length + " embedded assets.",
);
