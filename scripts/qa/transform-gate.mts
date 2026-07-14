// transform-gate — el juez del transform de ingestión (spec 2026-07-14).
// Fixtures REALES del catálogo vivo (scratch/transform-fixtures/, bajados
// read-only con scratch/fetch-fixtures.mts) + Chrome de verdad. Corre:
//   npm run transform:gate
//
// Por fixture: transform → sanitize (lo que de verdad se guarda/publica) →
// aserciones. La aserción REINA es anti-página-en-blanco: el texto visible
// del resultado en Chrome jamás puede ser menor que el de hoy (sanitize sin
// transform). Cero jsdom aquí: computed en navegador real — lección de las
// cinco instancias del patrón efecto-no-causa.
import { readFileSync, existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { sanitizeForPublish } from "@/lib/html-engine";
import { transformIngestedHtml } from "@/lib/transform";
import { findBakeTargets } from "@/lib/transform/targets";

const FIXTURES = ["arcana", "northbrook-dental", "pebble-walkers", "salon", "heron", "choir", "abismo"];
const DIR = "scratch/transform-fixtures";

let failures = 0;
const check = (fixture: string, name: string, ok: boolean, detail = "") => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const htmlTag = (h: string) => /<html\b[^>]*>/i.exec(h)?.[0] ?? "";
const containerFilled = (h: string, id: string) => {
  const re = new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>([\\s\\S]*?)</`, "i");
  const m = re.exec(h);
  return !!m && m[1].trim().length > 0;
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
  args: ["--disable-dev-shm-usage"],
});

async function visibleTextLength(html: string): Promise<number> {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      r.abort().catch(() => {});
    });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
    return await page.evaluate(() => document.body?.innerText.trim().length ?? 0);
  } finally {
    await page.close().catch(() => {});
  }
}

for (const id of FIXTURES) {
  const file = `${DIR}/${id}.html`;
  if (!existsSync(file)) {
    console.error(`FALTA ${file} — corre: npx tsx --env-file=.env.local scratch/fetch-fixtures.mts`);
    process.exit(2);
  }
  const source = readFileSync(file, "utf8");
  console.log(`\n=== ${id} ===`);

  const out = await transformIngestedHtml(source, { timeoutMs: 20_000, source: `gate:${id}` });
  check(id, "sin fallback", out.report.fallback === undefined, out.report.fallback);
  check(id, "cero data-ol-bake- residuales", !out.html.includes("data-ol-bake-"));
  check(id, "<html> byte-idéntico (la trampa class=js)", htmlTag(out.html) === htmlTag(source));
  const left = findBakeTargets(out.html);
  check(id, "cero objetivos de bake restantes", left.containers === 0 && left.geoms === 0, `c=${left.containers} g=${left.geoms}`);

  // Lo que DE VERDAD se guarda: el sanitize de la ruta encima del transform.
  const shipped = sanitizeForPublish(out.html).html ?? "";
  const shippedToday = sanitizeForPublish(source).html ?? "";
  check(id, "el sanitize acepta el resultado", shipped.length > 0);

  // Anti-página-en-blanco, en Chrome real: el texto visible no encoge.
  const before = await visibleTextLength(shippedToday);
  const after = await visibleTextLength(shipped);
  check(id, "texto visible NO encoge vs hoy", after >= before, `hoy=${before} transformado=${after}`);

  // Idempotencia sobre el resultado del transform.
  const second = await transformIngestedHtml(out.html, { timeoutMs: 20_000 });
  check(id, "idempotente", second.html === out.html);

  if (id === "arcana") {
    for (const c of ["filmstrip", "charGrid", "newsGrid"]) {
      check(id, `#${c} lleno`, containerFilled(shipped, c));
    }
  }
  if (id === "northbrook-dental") check(id, "#calgrid lleno", containerFilled(shipped, "calgrid"));
  if (id === "pebble-walkers") check(id, "#sizeGrid lleno", containerFilled(shipped, "sizeGrid"));
  if (id === "salon") {
    check(id, "#archive-grid lleno", containerFilled(shipped, "archive-grid"));
    // Medido en la primera corrida del gate (2026-07-14): las cards que el
    // script de salon horneó NO traen data-tag (filtraba re-renderizando
    // desde un array JS, no toggleando atributos) — la categoría es TEXTO
    // dentro de la card. Minarla sería la reescritura especulativa que el
    // spec prohíbe. La promesa correcta es la CONSERVADORA: o traducción
    // completa, o CERO marcadores a medias.
    check(id, "filter: skip conservador limpio (sin traducción a medias)",
      !shipped.includes("data-ol-filter"));
  }
  if (id === "heron") {
    check(id, "copy traducido", shipped.includes("data-ol-copy=") && shipped.includes("data-ol-copied="));
  }
  if (id === "choir") {
    check(id, "tabs inventariados", out.report.tabsFound >= 3);
    // Los paneles reales de choir son <pre id="tab-py" class="block"> — el
    // primer gate falló por asumir <div> (lección: afirmar la forma real).
    check(id, "algún panel de tab visible", /<[a-z]+[^>]*\bid="tab-[a-z]+"(?![^>]*\bhidden\b)[^>]*>/.test(shipped));
  }
  if (id === "abismo") {
    check(id, "la clase js JAMÁS llegó a <html>", !/<html[^>]*class="[^"]*\bjs\b/.test(out.html));
  }
}

await browser.close();

console.log(failures === 0 ? "\nGATE PASSED" : `\nGATE FAILED — ${failures} aserciones rojas`);
process.exit(failures === 0 ? 0 : 1);
