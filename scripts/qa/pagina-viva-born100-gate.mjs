// scripts/qa/pagina-viva-born100-gate.mjs
//
// LA PÁGINA PUBLICADA CORRE, Y SIGUE SIENDO BORN-100.
//
// Publica una página REAL por `publishToDir`, la sirve por HTTP tal como
// aterriza en disco, la abre con un Chrome de verdad y comprueba tres cosas:
//
//   1. el JavaScript del modelo SOBREVIVE la publicación y CORRE en el
//      navegador — sin errores de consola;
//   2. la página no pierde el contenido al hacerlo (funciona sin el script);
//   3. Lighthouse móvil con estrangulamiento: performance >=99,
//      a11y/best-practices/seo = 100 (Born-100, mismos umbrales que 3d:gate).
//
// ── DE DÓNDE VIENE ESTE FICHERO ───────────────────────────────────────────
//
// Era `behaviors-born100-gate.mjs` y comprobaba que las NUEVE conductas
// (`data-ol-countdown`, `-filter`, `-lightbox`…) funcionaran en una página
// publicada. Llevaba roto desde el 2026-08-23 sin que nadie lo mirara —
// comprobado con `git stash` el 28/08: fallaba idéntico antes de tocarlo—
// porque el producto se movió debajo de él por TRES decisiones deliberadas
// que la puerta no conocía:
//
//   · `bakeBehaviors` ya NO se llama al publicar. Hoy su único llamador vivo
//     es la vista previa del taller. Exigir las nueve conductas en una página
//     publicada era exigir algo que la tubería no hace.
//   · LA CSP SE QUITÓ A PROPÓSITO (`lib/publish/filesystem.ts`): «quitar la
//     jaula y acotar el daño por dominio». La puerta pedía el meta
//     `data-ol-csp` que ya nadie escribe. Con ella se fue también la única
//     razón original de este fichero —cazar una deriva del hash CSP—, porque
//     ya no hay hashes que derivar.
//   · EL SANEADOR YA NO CORRE AL PUBLICAR: sanea la INGESTIÓN. La puerta metía
//     HTML directo a `publishToDir`, saltándose la puerta real, y luego se
//     quejaba de que el `onclick=` «sobrevivía». Comprobaba la puerta
//     equivocada. Eso pertenece a las pruebas de ingestión, no aquí.
//
// Lo que se conserva es lo que no tiene sustituto en ningún otro sitio:
// publicar de verdad, servirlo por HTTP y mirarlo con un navegador. Lo que
// cambia es lo que se afirma, que ahora es lo que el producto promete hoy:
// **el JavaScript que escribe el modelo llega vivo a la página del usuario.**
//
// Chrome: si no arranca, esta puerta sale 1. No hay pase «sólo estático» —
// la verdad del navegador es el motivo entero de que exista.
//
// PUBLISH_ROOT: `getRoot()` lo lee para poder publicar a un tmp en vez de
// /var/www/openlen. Los horneados que tocan red (imagen/fuente) se apagan
// igual que en multi-page-publish.test.ts: hermeticidad, nada más.

import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";

const lighthouse = (await import("lighthouse")).default;
const puppeteer = (await import("puppeteer")).default;

const SUB = "pagina-viva-gate";

// LA PÁGINA. Es lo que el modelo escribe hoy: contenido completo y legible,
// y UN solo <script> al final del body que lo mejora. Nada de marcadores
// declarativos — ese catálogo se retiró (ver lib/conductas-heredadas).
//
// El script hace las dos cosas que el producto promete y que antes exigían
// una receta nuestra: filtrar una lista y contar hacia arriba al entrar en
// pantalla. Sin Tailwind CDN ni Google Fonts: cero red, para que Lighthouse
// mida la página y no la conexión.
function buildPage() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taquería El Norte — tacos al pastor en Monterrey</title>
<meta name="description" content="Taquería familiar en Monterrey desde 1989. Tacos al pastor, suadero y campechanos, con servicio a domicilio.">
<style>
  :root { --tinta:#1f2937; --acento:#b23a0b; --papel:#fffaf5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--papel); color:var(--tinta);
         font-family:system-ui,-apple-system,"Segoe UI",sans-serif; line-height:1.6; }
  main { max-width:44rem; margin:0 auto; padding:2rem 1.25rem 4rem; }
  h1 { font-size:2rem; line-height:1.15; margin:0 0 .5rem; }
  h2 { font-size:1.25rem; margin:2.5rem 0 .75rem; }
  .filtros { display:flex; gap:.5rem; flex-wrap:wrap; margin:0 0 1rem; padding:0; list-style:none; }
  .filtros button { font:inherit; padding:.4rem .9rem; border:1px solid var(--tinta);
                    background:transparent; color:var(--tinta); border-radius:999px; cursor:pointer; }
  .filtros button[aria-pressed="true"] { background:var(--tinta); color:var(--papel); }
  ul.carta { list-style:none; padding:0; margin:0; display:grid; gap:.5rem; }
  ul.carta li { border:1px solid #e7ded6; border-radius:.5rem; padding:.75rem 1rem; background:#fff; }
  .cifra { font-size:2.5rem; font-weight:700; color:var(--acento); font-variant-numeric:tabular-nums; }
  .lejos { margin-top:60vh; }
</style>
</head>
<body>
<main>
  <h1>Taquería El Norte</h1>
  <p>Tacos al pastor desde 1989, en la colonia Independencia. Negocio familiar,
     carne marinada cada mañana y servicio a domicilio en toda la ciudad.</p>

  <h2>Nuestra carta</h2>
  <ul class="filtros" id="filtros">
    <li><button type="button" data-tag="todo" aria-pressed="true">Todo</button></li>
    <li><button type="button" data-tag="carne" aria-pressed="false">Carne</button></li>
    <li><button type="button" data-tag="sin-carne" aria-pressed="false">Sin carne</button></li>
  </ul>
  <ul class="carta" id="carta">
    <li data-tag="carne">Al pastor — 25 pesos</li>
    <li data-tag="carne">Suadero — 27 pesos</li>
    <li data-tag="carne">Campechano — 30 pesos</li>
    <li data-tag="sin-carne">Nopal asado — 22 pesos</li>
    <li data-tag="sin-carne">Papa con rajas — 22 pesos</li>
  </ul>

  <h2 class="lejos">Cuántos hemos servido</h2>
  <p><span class="cifra" id="cifra">5000</span> tacos servidos este año.</p>
</main>

<script>
(function () {
  // Filtrar la carta. La página YA es completa sin esto: los cinco platillos
  // están en el HTML y se leen igual con el JavaScript apagado.
  var filtros = document.getElementById("filtros");
  var carta = document.getElementById("carta");
  if (filtros && carta) {
    filtros.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tag]");
      if (!b) return;
      var tag = b.getAttribute("data-tag");
      filtros.querySelectorAll("button[data-tag]").forEach(function (o) {
        o.setAttribute("aria-pressed", String(o === b));
      });
      carta.querySelectorAll("li[data-tag]").forEach(function (li) {
        li.style.display = tag === "todo" || li.getAttribute("data-tag") === tag ? "" : "none";
      });
    });
  }

  // Subir la cifra al entrar en pantalla. Nace con el valor final escrito en
  // el HTML — si el script no corre, el número sigue siendo correcto.
  var cifra = document.getElementById("cifra");
  if (cifra && "IntersectionObserver" in window) {
    var meta = parseInt(cifra.textContent, 10) || 0;
    var io = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.disconnect();
        var t0 = 0;
        (function paso(t) {
          if (!t0) t0 = t;
          var p = Math.min(1, (t - t0) / 700);
          cifra.textContent = String(Math.round(meta * p));
          if (p < 1) requestAnimationFrame(paso);
        })(0);
        requestAnimationFrame(function (t) { t0 = t; });
      });
    });
    io.observe(cifra);
  }
})();
</script>
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
    record(n, name, false, `lanzó: ${err?.message ?? err}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Servir el artefacto publicado de verdad ───────────────────────────────
let releaseDir = null;
const server = createServer((req, res) => {
  const rawUrl = (req.url || "/").split("?")[0];
  if (!releaseDir) {
    res.writeHead(503);
    res.end();
    return;
  }
  // El navegador pide /favicon.ico solo. Sin esto su 404 ensucia la aserción
  // titular de consola y esconde un 404 de verdad detrás del ruido.
  if (rawUrl === "/favicon.ico") {
    res.writeHead(200, { "content-type": "image/svg+xml" });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#c2410c"/></svg>');
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

const publishRoot = mkdtempSync(join(tmpdir(), "olviva-publish-"));
process.env.PUBLISH_ROOT = publishRoot;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";

const { publishToDir } = await import("../../lib/publish/filesystem.ts");
const publishResult = await publishToDir({ subdomain: SUB, html: buildPage() });
releaseDir = join(publishRoot, SUB, "releases", publishResult.sha);
console.log(`Publicada ${SUB} -> ${releaseDir} (sha ${publishResult.sha})`);

// ── Comprobaciones estáticas (sin Chrome) ─────────────────────────────────
const servedHtml = readFileSync(join(releaseDir, "index.html"), "utf8");
const staticFail = [];

// EL SCRIPT DEL MODELO TIENE QUE LLEGAR AL DISCO. Es la afirmación que
// sustituye a las nueve conductas: lo que se publica es lo que el modelo
// escribió, no una receta nuestra.
if (!/<script[\s>]/i.test(servedHtml)) {
  staticFail.push("el <script> del modelo NO llegó al HTML publicado — la publicación se lo comió");
}
if (!servedHtml.includes("IntersectionObserver")) {
  staticFail.push("el cuerpo del script del modelo se perdió por el camino (falta IntersectionObserver)");
}
// Y el contenido tiene que seguir ahí SIN el script: una página que sólo
// existe si el JavaScript corre no es una página, es una aplicación rota.
for (const texto of ["Al pastor", "Nopal asado", "Taquería El Norte"]) {
  if (!servedHtml.includes(texto)) staticFail.push(`falta contenido en el HTML publicado: "${texto}"`);
}

console.log("\nComprobaciones estáticas: " + (staticFail.length ? "FALLARON" : "OK"));
for (const f of staticFail) console.log("  - " + f);

// ── Chrome: navegador de verdad + Lighthouse ──────────────────────────────
const LH_THRESHOLDS = { performance: 99, accessibility: 100, bestPractices: 100, seo: 100, lcpMs: 1600, tbtMs: 200 };
let lhResults = null;
const lhFail = [];

try {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const errores = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errores.push(`[consola] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errores.push(`[pageerror] ${String(err?.message ?? err)}`));
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await page.goto(origin + "/", { waitUntil: "load" });

  console.log("\nAfirmaciones en un navegador de verdad:");

  await safeAssert(1, "CERO errores de consola en la página publicada (titular)", async () => {
    await wait(400);
    return { pass: errores.length === 0, detail: errores.length ? errores.join(" | ").slice(0, 300) : "limpia" };
  });

  await safeAssert(2, "el JavaScript del modelo CORRE: filtrar oculta lo que no toca", async () => {
    await page.click('#filtros button[data-tag="sin-carne"]');
    await wait(120);
    const v = await page.evaluate(() => {
      const oculto = document.querySelector('#carta li[data-tag="carne"]');
      const visible = document.querySelector('#carta li[data-tag="sin-carne"]');
      return {
        oculto: getComputedStyle(oculto).display,
        visible: getComputedStyle(visible).display,
      };
    });
    return { pass: v.oculto === "none" && v.visible !== "none", detail: JSON.stringify(v) };
  });

  // ESTA ASERCIÓN NACIÓ VACUA, y su primera corrida lo enseñó: comprobaba que
  // la cifra acabara en 5000, y el HTML ya nace con 5000 — habría pasado con
  // el JavaScript APAGADO, que es justo lo que no puede pasar en la puerta que
  // existe para probar que el script corre. Ahora exige verla A MEDIAS.
  await safeAssert(3, "y la cifra sube sola al entrar en pantalla", async () => {
    const visto = await page.evaluate(async () => {
      const el = document.getElementById("cifra");
      let minimo = Infinity;
      el.scrollIntoView();
      for (let i = 0; i < 60; i++) {
        const v = parseInt(el.textContent, 10);
        if (Number.isFinite(v)) minimo = Math.min(minimo, v);
        await new Promise((r) => setTimeout(r, 20));
      }
      return { minimo, final: el.textContent };
    });
    return {
      pass: visto.minimo < 5000 && visto.final === "5000",
      detail: `mínimo visto=${visto.minimo} final=${visto.final}`,
    };
  });

  // LA PÁGINA SIN SU SCRIPT SIGUE SIENDO UNA PÁGINA. El JavaScript mejora,
  // nunca construye el contenido — es la regla que el propio prompt le da al
  // modelo, y aquí se comprueba de verdad.
  await safeAssert(4, "con el JavaScript APAGADO el contenido sigue completo", async () => {
    const mudo = await ctx.newPage();
    await mudo.setJavaScriptEnabled(false);
    await mudo.goto(origin + "/", { waitUntil: "load" });
    const texto = await mudo.evaluate(() => document.body.innerText);
    await mudo.close();
    const faltan = ["Al pastor", "Nopal asado", "5000"].filter((t) => !texto.includes(t));
    return { pass: faltan.length === 0, detail: faltan.length ? `faltó: ${faltan.join(", ")}` : "completo" };
  });

  await ctx.close();

  // ── Lighthouse: mismos umbrales que 3d-born100-gate.mjs ────────────────
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

  console.log("\nLighthouse (móvil, estrangulado — misma configuración que 3d:gate):");
  console.log(JSON.stringify(lhResults, null, 2));

  // QUÉ falló, no sólo cuánto. Una puerta que dice «accessibility 95» y te
  // deja adivinando cuesta más de lo que protege.
  const suspendidas = Object.values(lhr.audits).filter(
    (a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== "informative",
  );
  if (suspendidas.length) {
    console.log("");
    console.log("Auditorías por debajo de 1:");
    for (const a of suspendidas) console.log(`  - ${a.id}: ${a.title}`);
  }

  if (lhResults.performance < LH_THRESHOLDS.performance) lhFail.push(`performance ${lhResults.performance} < ${LH_THRESHOLDS.performance}`);
  if (lhResults.accessibility < LH_THRESHOLDS.accessibility) lhFail.push(`accessibility ${lhResults.accessibility} < ${LH_THRESHOLDS.accessibility}`);
  if (lhResults.bestPractices < LH_THRESHOLDS.bestPractices) lhFail.push(`best-practices ${lhResults.bestPractices} < ${LH_THRESHOLDS.bestPractices}`);
  if (lhResults.seo < LH_THRESHOLDS.seo) lhFail.push(`seo ${lhResults.seo} < ${LH_THRESHOLDS.seo}`);
  if (lhResults.lcpMs > LH_THRESHOLDS.lcpMs) lhFail.push(`LCP ${lhResults.lcpMs}ms > ${LH_THRESHOLDS.lcpMs}`);
  if (lhResults.tbtMs > LH_THRESHOLDS.tbtMs) lhFail.push(`TBT ${lhResults.tbtMs}ms > ${LH_THRESHOLDS.tbtMs}`);
} catch (err) {
  const msg = err?.message ?? String(err);
  const chromeAusente =
    /Could not find Chrome|No usable sandbox|chrome not found|executable|protocol error|ECONNREFUSED|spawn/i.test(msg);
  server.close();
  if (chromeAusente) {
    console.error("\nChrome no disponible:\n  " + msg.slice(0, 300));
    console.error(
      "\nPUERTA NO SATISFECHA — hace falta Chrome: la verdad del navegador es el motivo entero de este fichero, " +
        "y no hay pase «sólo estático». Pon PUPPETEER_EXECUTABLE_PATH si Chrome está en otro sitio.",
    );
    process.exit(1);
  }
  throw err;
}

// ── Veredicto ─────────────────────────────────────────────────────────────
const funcionalFail = results.filter((r) => !r.pass).map((r) => `${r.n}. ${r.name} — ${r.detail}`);
const allFail = [...staticFail, ...funcionalFail, ...lhFail];

if (allFail.length) {
  console.error("\nPUERTA FALLIDA:\n - " + allFail.join("\n - "));
  process.exit(1);
}

console.log("\nPUERTA PASADA");
