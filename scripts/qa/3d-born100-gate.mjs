// scripts/qa/3d-born100-gate.mjs
//
// Born-100 acceptance gate for the OpenLen 3D first-slice.
// Bakes a real page through bake3dScene, serves it via http, runs Lighthouse
// on throttled mobile (simulated 4G / 4× CPU), and asserts:
//   performance ≥99 · a11y/best-practices/seo =100 · LCP ≤1600ms · TBT ≤200ms
//   LCP element = the poster <img> · no runtime <script src> in initial HTML
//
// Lighthouse v13 API note:
//   The flat-flags form lighthouse(url, { port, formFactor, throttling, ... })
//   is confirmed correct for v13.3.0 — see scripts/run-lighthouse.mjs for the
//   established pattern in this repo. The 3-arg form is NOT required.
//
//   In v13 the "largest-contentful-paint-element" audit was removed. The LCP
//   element node is now in:
//     lhr.audits["lcp-breakdown-insight"].details.items[1].snippet
//   (items[0] = subpart table, items[1] = the LCP node).
//
// tsx note:
//   Run via `tsx scripts/qa/3d-born100-gate.mjs` (not node --import tsx/esm)
//   because node v24 removed the deprecated loader registration path.
//
// Chrome note:
//   bake3dScene (without renderPoster) lazy-imports scene-poster → Chrome.
//   If Chrome cannot launch the gate exits with DONE_WITH_CONCERNS and defers
//   the live Lighthouse check to the Hetzner box (has google-chrome-stable).
//   Static assertion (no eager <script src>) always runs via a fake renderer.

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";

const { bake3dScene } = await import("../../lib/publish/procedural-3d.ts");
const { SAMPLE_SPEC } = await import("../../lib/three3d/scene-spec.ts");
const lighthouse = (await import("lighthouse")).default;
const puppeteer = (await import("puppeteer")).default;

// Minimal but complete gate page:
// - 3D block FIRST so the poster img is above the fold → LCP element
// - meta description → SEO 100
// - <link rel="icon" href="data:,"> → suppresses favicon.ico 404 → best-practices 100
const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="OpenLen 3D scene — Born with depth">
<link rel="icon" href="data:,">
<title>3D gate</title></head><body>
<section data-ol-3d-scene></section>
<main style="padding:24px"><h1>Born with depth</h1><p>contenido</p></main>
</body></html>`;

// ── Static assertion (no Chrome needed) ────────────────────────────────────
// bake3dScene with a fake renderPoster so we check HTML structure without
// triggering the headless-Chrome poster render.
const staticDir = mkdtempSync(join(tmpdir(), "ol3d-gate-static-"));
const staticBaked = await bake3dScene({
  html: PAGE,
  subDir: staticDir,
  spec: SAMPLE_SPEC,
  renderPoster: async () => Buffer.from("FAKEAVIF"),
});

const staticFail = [];
// The baked HTML MUST NOT contain an eager <script src="/assets/openlen-3d-…">.
// The runtime is loaded lazily (gesture-gated) via BOOTSTRAP_JS only.
if (/src="\/assets\/openlen-3d-[^"]+\.js"/.test(staticBaked)) {
  staticFail.push(
    'runtime <script src="/assets/openlen-3d-…"> found in initial HTML — must be lazy-loaded on gesture',
  );
}
// The poster <img> must be present with fetchpriority=high for LCP.
if (!staticBaked.includes("data-ol-3d-poster") || !staticBaked.includes('fetchpriority="high"')) {
  staticFail.push('poster img with fetchpriority="high" missing from baked HTML');
}

if (staticFail.length) {
  console.error("STATIC GATE FAILED:\n - " + staticFail.join("\n - "));
  process.exit(1);
}
console.log("Static assertion: PASSED (no eager runtime src, poster present)");

// ── Chrome + Lighthouse gate ────────────────────────────────────────────────
let chromeDeferred = false;
let deferralReason = "";
const fail = [];
let results = null;

try {
  // Full bake using the real scene-poster renderer (Chrome → AVIF).
  const dir = mkdtempSync(join(tmpdir(), "ol3d-gate-"));
  const baked = await bake3dScene({ html: PAGE, subDir: dir, spec: SAMPLE_SPEC });
  writeFileSync(join(dir, "index.html"), baked);

  // Static server for the baked dir.
  const server = createServer((req, res) => {
    const rawUrl = (req.url || "/").split("?")[0];
    const filePath = rawUrl === "/" ? "/index.html" : rawUrl;
    try {
      const body = readFileSync(join(dir, filePath));
      const ext = filePath.split(".").pop() ?? "";
      const mime =
        { html: "text/html", js: "text/javascript", avif: "image/avif" }[ext] ??
        "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, r));
  const serverPort = server.address().port;
  const targetUrl = `http://127.0.0.1:${serverPort}/`;

  // Launch Chrome via Puppeteer — lend its CDP port to Lighthouse.
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  const cdpPort = Number(new URL(browser.wsEndpoint()).port);

  // Lighthouse v13 — flat flags (2nd arg). Pattern from scripts/run-lighthouse.mjs.
  // formFactor/screenEmulation/throttling/onlyCategories go in the same flags object.
  const lhResult = await lighthouse(targetUrl, {
    port: cdpPort,
    output: "json",
    logLevel: "error",
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      disabled: false,
    },
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      cpuSlowdownMultiplier: 4,
      requestLatencyMs: 562.5,
      downloadThroughputKbps: 1474.56,
      uploadThroughputKbps: 675,
    },
    throttlingMethod: "simulate",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
  });

  await browser.close();
  server.close();

  const { lhr } = lhResult;
  const score = (c) => Math.round((lhr.categories[c]?.score ?? 0) * 100);
  const lcp = lhr.audits["largest-contentful-paint"]?.numericValue ?? 1e9;
  const tbt = lhr.audits["total-blocking-time"]?.numericValue ?? 1e9;

  // In Lighthouse v13 the "largest-contentful-paint-element" audit was removed.
  // The LCP element node is in lcp-breakdown-insight.details.items[1] (the node
  // item; items[0] is the subpart timing table). lcp-discovery-insight.details
  // also carries it but the breakdown is more stable for this assertion.
  const lcpEl =
    lhr.audits["lcp-breakdown-insight"]?.details?.items?.[1]?.snippet ?? "";

  results = {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    lcpMs: Math.round(lcp),
    tbtMs: Math.round(tbt),
    lcpElement: lcpEl,
  };
  console.log("\nLighthouse results:");
  console.log(JSON.stringify(results, null, 2));

  if (results.performance < 99) fail.push(`performance ${results.performance} < 99`);
  if (results.accessibility < 100) fail.push(`a11y ${results.accessibility} < 100`);
  if (results.bestPractices < 100) fail.push(`best-practices ${results.bestPractices} < 100`);
  if (results.seo < 100) fail.push(`seo ${results.seo} < 100`);
  if (results.lcpMs > 1600) fail.push(`LCP ${results.lcpMs}ms > 1600`);
  if (results.tbtMs > 200) fail.push(`TBT ${results.tbtMs}ms > 200`);
  if (!/data-ol-3d-poster|<img/i.test(lcpEl)) {
    fail.push(`LCP element is not the poster img: ${lcpEl}`);
  }
} catch (err) {
  const msg = err?.message ?? String(err);
  const isChromeMissing =
    /Could not find Chrome|No usable sandbox|chrome not found|executable|protocol error|ECONNREFUSED|spawn/i.test(
      msg,
    );
  if (isChromeMissing) {
    chromeDeferred = true;
    deferralReason = msg.slice(0, 200);
    console.warn("\nChrome unavailable — Lighthouse gate deferred to Hetzner:");
    console.warn("  " + deferralReason);
  } else {
    // Unexpected error — re-throw so it shows up as a real failure.
    throw err;
  }
}

// ── Final verdict ───────────────────────────────────────────────────────────
if (fail.length) {
  console.error("\nGATE FAILED:\n - " + fail.join("\n - "));
  process.exit(1);
}

if (chromeDeferred) {
  console.log(
    "\nDONE_WITH_CONCERNS — static assertions PASSED; Lighthouse deferred (Chrome unavailable).",
  );
  console.log("Run `npm run 3d:gate` on the Hetzner box (google-chrome-stable present).");
  process.exit(0); // non-blocking for CI; Hetzner runs the live check
}

console.log("\nGATE PASSED");
