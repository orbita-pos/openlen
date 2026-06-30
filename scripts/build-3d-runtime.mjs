// scripts/build-3d-runtime.mjs
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("lib/three3d/runtime/dist", { recursive: true });

await build({
  entryPoints: ["lib/three3d/runtime/index.ts"],
  bundle: true,
  format: "iife",
  minify: true,
  target: ["es2019"],
  outfile: "lib/three3d/runtime/dist/openlen-3d.js",
  legalComments: "none",
});

console.log("built lib/three3d/runtime/dist/openlen-3d.js");
