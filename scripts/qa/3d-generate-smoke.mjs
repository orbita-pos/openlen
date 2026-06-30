// scripts/qa/3d-generate-smoke.mjs
//
// Credit-free smoke harness for the OpenLen 3D generation→bake→poster seam.
// For each GOLDEN brief, runs generateSceneSpec in MOCK mode (no Gemini),
// bakes the scene (real headless-Chrome poster via bake3dScene), and dumps
// the AVIF to scratch/3d-smoke/ for eyeballing.
//
// Run: npm run 3d:generate-smoke
// Needs: headless Chrome (Puppeteer) — NOT Gemini credits.
//
// tsx note:
//   Run via `tsx scripts/qa/3d-generate-smoke.mjs` (not node --import tsx/esm)
//   because node v24 dropped the deprecated loader registration path.
//   tsx resolves the .ts imports at the top level.
//
// Chrome note:
//   bake3dScene (without renderPoster) lazy-imports scene-poster → Chrome.
//   If Chrome cannot launch the harness exits 1 with FAILURES.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { generateSceneSpec } = await import("../../lib/three3d/generate-spec.ts");
const { bake3dScene } = await import("../../lib/publish/procedural-3d.ts");
const { GOLDEN } = await import("../../lib/three3d/golden-specs.ts");

const outDir = join("scratch", "3d-smoke");
mkdirSync(outDir, { recursive: true });

let ok = 0;
const fail = [];

for (const g of GOLDEN) {
  const slug = g.brief.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  try {
    // mock provider: deterministic golden lookup → spec (no Gemini, no credits)
    const { spec } = await generateSceneSpec({ describe: g.brief }, { provider: "mock" });
    const subDir = join(outDir, slug);
    mkdirSync(join(subDir, "assets"), { recursive: true });
    // real bake → headless-Chrome poster AVIF
    await bake3dScene({ html: "<html><head></head><body></body></html>", subDir, spec });
    // copy the poster to the root outDir for easy eyeballing
    const fs = await import("node:fs");
    const asset = fs.readdirSync(join(subDir, "assets")).find((f) => f.endsWith(".avif"));
    if (!asset) throw new Error("no poster produced");
    fs.copyFileSync(join(subDir, "assets", asset), join(outDir, `${slug}.avif`));
    console.log(`  ✓ ${slug}`);
    ok++;
  } catch (err) {
    console.error(`  ✗ ${slug}: ${err.message}`);
    fail.push(`${slug}: ${err.message}`);
  }
}

console.log(`\nrendered ${ok}/${GOLDEN.length} posters → ${outDir}`);
if (fail.length) {
  console.error("FAILURES:\n - " + fail.join("\n - "));
  process.exit(1);
}
console.log("SMOKE PASSED — eyeball the posters in", outDir);
