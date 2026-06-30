// Visual smoke-test for Fix 1: z-index:-1 backdrop (no specificity fight).
// Confirms that Tailwind-style .absolute inset-0 gradient overlay divs are NOT
// collapsed into normal flow. The old content-above rule (#hero>:not(...){
// position:relative;z-index:1}) had specificity (1,1,0) which beat .absolute
// (0,1,0), yanking overlay divs to height 0. Fix: z-index:-1 on backdrop +
// no child rule — the gradient overlay must remain visible.
//
// Renders to scratch/3d-smoke/png/hero-backdrop-fixed.png.
// Pass: (a) gradient overlay renders, (b) 3D backdrop visible, (c) text readable.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchScreenshotBrowser } from "../lib/templates/capture-screenshot.ts";
import { injectSceneMarkup } from "../lib/publish/procedural-3d.ts";
import { GOLDEN } from "../lib/three3d/golden-specs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const IRID = GOLDEN.find((g) => g.brief === "una esfera iridiscente");
if (!IRID) throw new Error("golden spec 'una esfera iridiscente' not found");

// Hero with BOTH a Tailwind-style .absolute inset-0 gradient overlay AND content.
// This is the exact pattern that Finding 1 broke.
//
// Using Tailwind via inline CDN so .absolute / .inset-0 are generated classes,
// as they would be on any AI-generated page. The gradient overlay must remain
// absolutely positioned and cover the full hero area.
const heroHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f0f;color:#fff;min-height:100vh}</style>
</head>
<body>
<section id="hero" class="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
  <!-- Tailwind .absolute inset-0: this div is the exact kind yanked into normal
       flow by the old content-above rule, collapsing to 0x0 and hiding the gradient. -->
  <div class="absolute inset-0 bg-gradient-to-br from-purple-900/60 via-transparent to-pink-900/40 pointer-events-none"></div>
  <!-- Second overlay (noise texture) — also .absolute inset-0 -->
  <div class="absolute inset-0 opacity-20 pointer-events-none"
       style="background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0,rgba(255,255,255,.03) 1px,transparent 0,transparent 50%);background-size:8px 8px"></div>
  <!-- Actual hero content — must be readable above backdrop AND overlays -->
  <div class="relative z-10 text-center px-8 max-w-4xl mx-auto">
    <h1 class="text-5xl font-black leading-tight mb-6 tracking-tight">
      Lanza tu página<br>
      <span class="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">en minutos</span>
    </h1>
    <p class="text-xl text-white/70 max-w-lg mx-auto leading-relaxed mb-8">
      Describe lo que necesitas y la IA crea una página lista para publicar. Sin código.
    </p>
    <a href="#" class="inline-block px-8 py-4 bg-purple-600 text-white font-semibold rounded-full">
      Crear mi página gratis
    </a>
  </div>
</section>
</body>
</html>`;

// Use the pre-rendered iridescent poster as a data URI (no file serving needed).
const posterBytes = readFileSync(
  join(ROOT, "scratch/3d-smoke/una-esfera-iridiscente/assets/scene-d710931f94c9.avif"),
);
const posterDataUri = `data:image/avif;base64,${posterBytes.toString("base64")}`;

// Runtime is no-op for static render (gesture-gated, no click during screenshot).
const injected = injectSceneMarkup(heroHtml, {
  spec: IRID.spec,
  posterUrl: posterDataUri,
  runtimeUrl: "data:application/javascript,",
  width: 1600,
  height: 900,
});

const outDir = join(ROOT, "scratch", "3d-smoke", "png");
mkdirSync(outDir, { recursive: true });

const browser = await launchScreenshotBrowser();
const pg = await browser.newPage();
await pg.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
// waitUntil networkidle0 to let Tailwind CDN load and generate utility classes.
await pg.setContent(injected, { waitUntil: "networkidle0", timeout: 30000 });
await pg.evaluate(() => document.fonts.ready);
// Brief settle for any AVIF decode / paint.
await pg.evaluate(() => new Promise((r) => setTimeout(r, 800)));

// Verify gradient overlays are still positioned absolutely (not collapsed).
const overlayCheck = await pg.evaluate(() => {
  const overlays = document.querySelectorAll(".absolute.inset-0");
  const results = [];
  for (const el of overlays) {
    const s = getComputedStyle(el);
    results.push({
      tag: el.tagName,
      position: s.position,
      height: el.getBoundingClientRect().height,
      width: el.getBoundingClientRect().width,
    });
  }
  return results;
});

console.log("Overlay computed styles:", JSON.stringify(overlayCheck, null, 2));
const collapsed = overlayCheck.filter((o) => o.height === 0 || o.width === 0);
if (collapsed.length > 0) {
  console.error("FAIL: overlay divs collapsed (position:relative yanked them into normal flow):", collapsed);
  process.exit(1);
}
console.log("PASS: all .absolute inset-0 overlays remain positioned absolutely (height > 0)");

const png = await pg.screenshot({
  type: "png",
  clip: { x: 0, y: 0, width: 1280, height: 800 },
});
const outPath = join(outDir, "hero-backdrop-fixed.png");
writeFileSync(outPath, png);
console.log(`rendered => ${outPath}`);
await pg.close();
await browser.close();
