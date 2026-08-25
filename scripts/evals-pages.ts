// scripts/evals-pages.ts — corre el conjunto fijo de briefs contra el modelo de
// verdad y escribe un marcador comparable con la corrida anterior.
//
// ESTO GASTA DINERO. Una página cuesta ~1-2 MXN, así que el conjunto completo
// ronda los 12-24 MXN. No se corre a diario: se corre antes de un despliegue y
// cuando se toca el prompt o el motor.
//
//   npm run evals:pages                    # el conjunto entero
//   npm run evals:pages -- --tag=regresion # sólo los que nacieron de un fallo
//   npm run evals:pages -- --max-mxn=8     # tope propio
//   npm run evals:pages -- --solo=solar,quiz --repeat=3
//                                          # unos pocos casos, N veces
//
// POR QUÉ `--repeat`. El modelo NO es determinista, así que una sola muestra
// por caso no distingue un defecto REAL de la varianza. Se vio medido: cuatro
// corridas del mismo cohorte dieron 12/12, 14/14, 14/16 y 13/16 sin que el
// código de las conductas cambiara entre las dos últimas. Los chequeos de
// forma/puerta/render son estables; los de ADOPCIÓN (¿usó el modelo la
// conducta?) oscilan, y ahí una corrida sola miente en las dos direcciones.
//
// Con `--repeat` el marcador deja de decir "pasó/falló" y pasa a decir "pasó N
// de M", que es lo único interpretable sobre un modelo no determinista.
//
// Reproduce la ruta de /api/generate: comprobaciones de forma → un reintento →
// el motor → regeneración por rotura medida. Medir un camino más corto que el
// del producto sería medir otra cosa.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { generateHtmlStream, pageWriterUsesDeepSeek } from "@/lib/ai-stream/generate";
import { generateSystemMessage } from "@/app/api/generate/system-prompt";
import { LANGUAGE_RULE } from "@/lib/ai/authoring-rules";
import { todayLine } from "@/lib/ai/today-line";
import { extractDocument } from "@/lib/ai/extract-document";
import { resolveAIProvider } from "@/lib/ai-provider";
import { creditRate, type CreditRate } from "@/lib/credits";
import { compileCalcRegions } from "@/lib/expr/document";
import { detectSlotPath } from "@/lib/html-engine";
import { preparePage } from "@/lib/page-engine/prepare";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { PAGE_COHORT, PAGE_COHORT_VERSION, type PageEvalCase } from "@/lib/evals/page-cohort";
import {
  buildScorecard,
  compareScorecards,
  judgePage,
  type PageMeasurement,
  type PageVerdict,
  type Scorecard,
} from "@/lib/evals/page-scorecard";
import type { Message } from "@/lib/ai-gateway";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

const OUT_DIR = join(process.cwd(), "scratch", "evals");
// La línea base se VERSIONA, junto al conjunto que mide. Si viviera en scratch
// cada máquina tendría la suya y "vs la corrida anterior" no significaría nada
// entre dos personas ni tras un clon nuevo. Los artefactos de cada corrida
// —el HTML de cada página— se quedan en scratch.
const BASELINE = join(process.cwd(), "lib", "evals", "baseline.json");
const USD_TO_MXN = 18.5;
// La tarifa sale de `lib/credits.ts` (RATES), la MISMA tabla con la que el
// producto cobra, y la elige QUIEN DE VERDAD CORRE — no el `model` que se le
// pasa a `generateHtmlStream`.
//
// Ese matiz cuesta dinero si se lee mal, y yo lo leí mal: el arnés pasa
// `model: "gemini-flash"`, pero `generateHtmlStream` decide el motor con
// `pageWriterUsesDeepSeek()`, que es OPT-OUT — sin `OPENLEN_GENERATE_PROVIDER`
// corre DeepSeek. Ver el interruptor y su regla en `lib/ai/provider-switch.ts`.
// Cobrar estas corridas a tarifa de Gemini las encarecería 9x en el papel, y un
// tope de gasto calculado sobre el precio de otro proveedor no es un tope.
//
// Con imágenes manda Gemini (Fireworks no tiene ojos), pero este cohorte no
// adjunta ninguna: son briefs de texto.

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const tag = flag("tag");
  const maxMxn = Number(flag("max-mxn") ?? "26");
  const solo = flag("solo")?.split(",").map((s2) => s2.trim()).filter(Boolean);
  const repeat = Math.max(1, Math.trunc(Number(flag("repeat") ?? "1")));
  const base = PAGE_COHORT.filter(
    (c) => (!tag || c.tag === tag) && (!solo || solo.includes(c.id)),
  );
  if (base.length === 0) throw new Error(`no hay casos con tag=${tag ?? "*"} solo=${solo?.join(",") ?? "*"}`);
  // Las repeticiones son casos con id propio (`solar#2`) para que el informe
  // por caso siga funcionando sin tratarlas como un modo aparte.
  const cases: PageEvalCase[] =
    repeat === 1
      ? [...base]
      : base.flatMap((c) => Array.from({ length: repeat }, (_, k) => (k === 0 ? c : { ...c, id: `${c.id}#${k + 1}` })));

  const provider = resolveAIProvider("gemini-flash");
  const apiKey = provider.key;
  // Sin imágenes en el cohorte, así que el segundo argumento es false.
  const enDeepSeek = pageWriterUsesDeepSeek(process.env, false);
  // La key de Gemini SÓLO se exige si Gemini es quien va a escribir. Sin
  // esto, con el escritor por defecto —DeepSeek— el arnés entero se caía en
  // la primera línea por una credencial que no iba a usar, y la key de
  // Gemini es de prepago: agotarse es su estado natural. Mismo defecto que
  // apagó los ojos de Len (hallazgo 11), en otra superficie.
  if (!enDeepSeek && !apiKey) {
    throw new Error(
      "falta GEMINI_API_KEY y el escritor de páginas es Gemini " +
        "(OPENLEN_GENERATE_PROVIDER=gemini). Quítalo para escribir con DeepSeek.",
    );
  }
  const rateKey: CreditRate = enDeepSeek ? "deepseek-flash" : provider.rate;
  const { input: IN_PER_M, output: OUT_PER_M } = creditRate(rateKey);
  console.log(
    `motor: ${enDeepSeek ? "DeepSeek V4 Flash (Fireworks)" : provider.label}` +
    ` · $${IN_PER_M}/M entrada · $${OUT_PER_M}/M salida`,
  );

  const revision = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const profile = { brand: null, photos: [], links: [] } as unknown as BusinessProfileData;
  // El costo sale del `usage` que reporta el proveedor en el resumen del
  // stream, no del hook de débito: `DebitFn` recibe `(userId, créditos)`, así
  // que leerle un objeto de uso daba 0 SIEMPRE — y un tope de gasto que no
  // puede dispararse es peor que no tener tope.
  let usd = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const noDebit = (async () => {}) as never;

  /** Una pasada del modelo + las comprobaciones de forma de la ruta. */
  async function pass(messages: Message[]): Promise<{ html: string; trimmed: number } | null> {
    const { stream, done } = generateHtmlStream(
      { apiKey: apiKey ?? "", messages, model: "gemini-flash", userId: "evals-pages", htmlOpts: { injectOpIds: false }, maxOutputTokens: 65_536, temperature: 0.8 },
      { debit: noDebit },
    );
    const reader = stream.getReader();
    for (;;) { const { done: d } = await reader.read(); if (d) break; }
    const s = await done;
    if (s.usage) {
      tokensIn += s.usage.inputTokens;
      tokensOut += s.usage.outputTokens;
      usd = (tokensIn * IN_PER_M + tokensOut * OUT_PER_M) / 1_000_000;
    }
    if (!s.finalHtml) return null;
    const html = extractDocument(s.finalHtml);
    if (html.length < 1000) return null;
    if (!/^\s*<!doctype/i.test(html)) return null;
    if (!/<\/html>\s*$/i.test(html)) return null;
    if (detectSlotPath(html)) return null;
    return { html, trimmed: s.finalHtml.length - html.length };
  }

  async function runCase(c: PageEvalCase): Promise<PageVerdict> {
    const started = Date.now();
    const briefBlock = `BRIEF:\n${c.brief}`;
    const messages: Message[] = [
      { role: "system", content: generateSystemMessage(process.env) },
      { role: "user", content: `${todayLine()}${LANGUAGE_RULE}${briefBlock}` },
    ];

    let attempts = 1;
    let got = await pass(messages);
    if (!got) { attempts = 2; got = await pass(messages); }
    if (!got) {
      return judgePage({ id: c.id, attempts: 0, trimmed: 0, ms: Date.now() - started }, c);
    }

    const engine = (h: string) => preparePage(h, { mode: "create", brief: c.brief, title: c.id, profile });
    let prepared = await engine(got.html);
    if (!prepared.ok) {
      return judgePage({ id: c.id, attempts, trimmed: got.trimmed, gateCode: prepared.code, ms: Date.now() - started }, c);
    }

    // Regeneración por rotura MEDIDA, igual que la ruta: se entrega la menos
    // rota, no la más reciente.
    if (prepared.report.breakage.length > 0) {
      const fixed = await pass([
        { role: "system", content: generateSystemMessage(process.env) },
        { role: "user", content: `<measured-breakage>\nEl navegador renderizó tu página anterior y midió esto:\n${prepared.report.breakage.map((r) => `- ${r}`).join("\n")}\n\nEscribe la página de nuevo sin esos defectos. No son opiniones: son medidas del render.\n</measured-breakage>\n\n${briefBlock}` },
      ]);
      if (fixed) {
        const second = await engine(fixed.html);
        if (second.ok && second.report.breakage.length <= prepared.report.breakage.length) prepared = second;
      }
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${c.id}.html`), prepared.html);

    // Se vuelve a compilar sobre la página YA preparada — es idempotente, y
    // devuelve lo único determinista que se puede afirmar de un cálculo:
    // cuántas fórmulas quedaron vivas y cuántas nacieron muertas.
    // `preparePage` en modo crear AVISA en vez de rechazar, así que una fórmula
    // rota SÍ llega hasta aquí y tiene que contarse.
    const calc = compileCalcRegions(prepared.html);
    const rendered = await renderVisualQualityViewports(prepared.html).catch(() => null);
    const htmlTag = /<html\b([^>]*)>/i.exec(prepared.html)?.[1] ?? "";
    const m: PageMeasurement = {
      id: c.id,
      attempts,
      trimmed: got.trimmed,
      ...(rendered ? {
        mobileOverflow: rendered.mobileOverflow,
        invalidGeometry: rendered.invalidGeometry,
        typographyRule: rendered.weakTypographyHierarchy ? (rendered.typographyHierarchy?.rule ?? "?") : null,
        unreadable: rendered.unreadableText?.length ?? 0,
      } : {}),
      h1Count: (prepared.html.match(/<h1[\s>]/gi) ?? []).length,
      lang: /lang="([^"]*)"/i.exec(htmlTag)?.[1] ?? "",
      dir: /dir="([^"]*)"/i.exec(htmlTag)?.[1] ?? "",
      bytes: prepared.html.length,
      calcFormulas: calc.compiled,
      calcIssues: calc.issues.length,
      ms: Date.now() - started,
    };
    return judgePage(m, c);
  }

  console.log(`${cases.length} casos · ${PAGE_COHORT_VERSION} · tope ${maxMxn} MXN\n`);
  const verdicts: PageVerdict[] = [];
  let aborted = false;
  for (const c of cases) {
    if (usd * USD_TO_MXN > maxMxn) {
      console.log(`ABORTADO antes de ${c.id} — ${(usd * USD_TO_MXN).toFixed(2)} MXN supera el tope`);
      aborted = true;
      break;
    }
    const v = await runCase(c);
    verdicts.push(v);
    const mark = v.failures.length === 0 ? "ok  " : "FALL";
    console.log(
      `${mark} ${v.id.padEnd(16)} ${String(Math.round(v.measurement.ms / 1000)).padStart(3)}s` +
      `${v.measurement.attempts > 1 ? " reintento" : ""}` +
      `${v.measurement.trimmed > 0 ? ` recorte:${v.measurement.trimmed}` : ""}` +
      `${v.failures.length ? "  → " + v.failures.join(",") : ""}`,
    );
  }

  const next = buildScorecard({
    cohortVersion: PAGE_COHORT_VERSION,
    revision,
    at: new Date().toISOString(),
    verdicts,
    costMxn: Number((usd * USD_TO_MXN).toFixed(2)),
    partial: aborted || verdicts.length !== PAGE_COHORT.length,
  });

  if (repeat > 1) {
    console.log("");
    console.log("tasa por caso (lo único interpretable con un modelo no determinista):");
    for (const c of base) {
      const suyos = verdicts.filter((v) => v.id === c.id || v.id.startsWith(`${c.id}#`));
      const limpios = suyos.filter((v) => v.failures.length === 0).length;
      const motivos = [...new Set(suyos.flatMap((v) => v.failures))];
      console.log(
        `  ${c.id.padEnd(16)} ${limpios}/${suyos.length}` +
        (motivos.length ? `   (${motivos.join(", ")})` : ""),
      );
    }
  }

  let prev: Scorecard | null = null;
  try { prev = JSON.parse(readFileSync(BASELINE, "utf8")) as Scorecard; } catch { prev = null; }
  const cmp = compareScorecards(prev, next);

  console.log(`\n${next.clean}/${next.pages} limpias · reintentos ${next.retried} · recortes ${next.trimmed} · ${next.costMxn} MXN`);
  if (Object.keys(next.byCode).length) {
    console.log(`fallos: ${Object.entries(next.byCode).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
  if (cmp.comparable) {
    console.log(`vs ${prev!.revision.slice(0, 8)}: ${cmp.delta! >= 0 ? "+" : ""}${cmp.delta} limpias`);
    if (cmp.regressed.length) console.log(`  REGRESIÓN: ${cmp.regressed.join(", ")}`);
    if (cmp.fixed.length) console.log(`  arregladas: ${cmp.fixed.join(", ")}`);
  } else {
    console.log(prev ? "el conjunto cambió de versión — no comparable" : "primera corrida — no hay con qué comparar");
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `page-scorecard-${revision.slice(0, 8)}.json`), JSON.stringify(next, null, 2));
  // Una corrida PARCIAL (--solo/--tag/--repeat) no puede pisar la línea base:
  // mide otro conjunto, y compararlo luego contra el cohorte entero daría un
  // delta inventado. Se guarda el marcador de la corrida y punto.
  if (solo || tag || repeat > 1) {
    console.log("");
    console.log("corrida parcial — la línea base NO se toca");
  } else {
    writeFileSync(BASELINE, JSON.stringify(next, null, 2));
    console.log(`
→ línea base actualizada: lib/evals/baseline.json`);
  }

  // Una regresión tiene que romper la puerta de quien lo corra en CI.
  if (cmp.regressed.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
