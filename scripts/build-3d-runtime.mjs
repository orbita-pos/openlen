// scripts/build-3d-runtime.mjs
import { build } from "esbuild";
import { mkdirSync, statSync } from "node:fs";

mkdirSync("lib/three3d/runtime/dist", { recursive: true });

const flags = { bundle: true, format: "iife", minify: true, target: ["es2019"], legalComments: "none" };

await build({
  ...flags,
  entryPoints: ["lib/three3d/runtime/index.ts"],
  outfile: "lib/three3d/runtime/dist/openlen-3d.js",
});
console.log("built lib/three3d/runtime/dist/openlen-3d.js");

// Shader-lite bundle — raw WebGL, no three. Hard budget: shader-only pages
// must stay tiny, so fail the build if it ever regresses past 15KB.
await build({
  ...flags,
  entryPoints: ["lib/three3d/runtime/lite-index.ts"],
  outfile: "lib/three3d/runtime/dist/openlen-3d-lite.js",
});
const sz = statSync("lib/three3d/runtime/dist/openlen-3d-lite.js").size;
if (sz > 15 * 1024) {
  console.error(`lite bundle ${sz}B > 15KB budget`);
  process.exit(1);
}
console.log(`built lib/three3d/runtime/dist/openlen-3d-lite.js (${(sz / 1024).toFixed(1)}KB)`);
