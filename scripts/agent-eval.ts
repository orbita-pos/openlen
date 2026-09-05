// scripts/agent-eval.ts — the OpenLen Agent's credit-conscious eval runner.
//
//   npm run evals:agent -- --limit=3 --yes
//   npm run evals:agent -- --only=activar-reservas,honesto-carrito --yes
//   npm run evals:agent -- --all --yes --budget-usd=1.50   (la batería completa DECLARA su costo)
//   npm run evals:agent -- --all --yes --costly --budget-usd=2   (incluye la edición de imagen pagada)
//   npm run evals:agent -- --canary --yes         (the 6 CANARY_IDS — fast smoke, ~18¢)
//
// TOPE DURO: sin --budget-usd, nada cuyo estimado supere $0.30 arranca (ni
// con --yes), y el gasto REAL acumulado detiene la batería a media corrida si
// toca el techo. Ver DEFAULT_BUDGET_USD abajo.
//
// Each case spends real Gemini credits, so the runner PRINTS a cost estimate
// first and REFUSES to run without --yes. Concurrency is 1 (shared prod Neon +
// rate limits). Exit code is non-zero if any case fails, so it can gate a
// commit. Owner is resolved from EVAL_USER_EMAIL (no default).

import { CANARY_IDS, EVAL_CASES, type EvalCase } from "@/lib/agent/evals/cases";
import { resolveEvalUser, runEvalCase, type EvalRunResult } from "@/lib/agent/evals/harness";
import { rateFor, VISION_RATE } from "@/lib/ai/tarifas-eval";
import { modelIdForRole } from "@/lib/generation/model-policy";

// P3 — eje visual: render local (gratis) + 1-2 llamadas de visión chicas por
// caso mutante. Sobreestimado a propósito (mejor sobrar que drenar).
const COST_PER_CASE_VISUAL_USD = 0.01;

// TOPE DURO DE GASTO (2026-07-14: una batería + re-runs vació el saldo
// prepagado de la cuenta — ~200 MXN — con un estimado citado de $0.42).
// Sin --budget-usd explícito, NADA cuyo estimado supere DEFAULT_BUDGET_USD
// arranca — ni con --yes: --yes confirma "esto gasta dinero", el budget es
// el TECHO de cuánto. Y durante la corrida, el gasto REAL acumulado
// (calculado de los tokens medidos, no del estimado) se comprueba tras cada
// caso: si toca el techo, la batería se detiene ahí mismo con los casos
// restantes sin correr. Preferimos una batería incompleta a una cuenta vacía.
const DEFAULT_BUDGET_USD = 0.3;
// Precios por millón de tokens. El razonador dejó de ser Gemini y estas cifras
// se quedaron: con las de Gemini, la salida de DeepSeek se contaba casi NUEVE
// veces cara y el tope frenaba una batería que apenas había gastado. Un tope
// que miente en cualquiera de las dos direcciones no protege nada.
//
// Las llamadas de VISIÓN siguen siendo Gemini pase lo que pase (los ojos del
// harness usan gemini-2.5-flash), así que se cobran aparte, a su tarifa.
//
// 🔴 LAS TARIFAS SALEN DE `lib/credits.ts`, NO DE AQUÍ. Estaban cableadas y
// desfasadas —0.14/0.28 contra los 0.22/0.66 reales— y sin entrada para Pro,
// que es el modelo que corre el Agente desde el 2026-08-28: caía al respaldo
// y se cobraba como Gemini. Un tope calculado sobre un precio que no es el
// real no es un tope, y esta batería SÓLO existe para poder confiar en él.
//
// Es la misma corrección que ya se le hizo a `scripts/evals-pages.ts`; este
// fichero se quedó atrás.
// Las tarifas viven en lib/ai/tarifas-eval.ts desde el 2026-09-04: un segundo
// runner (scripts/sobre-ab.ts) las necesita, y copiarlas es como se quedaron
// desfasadas la vez anterior.


// COSTO POR CASO, DERIVADO DEL MODELO QUE VA A CORRER — no una constante.
//
// Era 0.03 fijo, calibrado cuando el Agente corría en Flash. Desde el
// 2026-08-28 corre en Pro, que cuesta 6x, así que ese número subestimaba por
// seis y la puerta del presupuesto dejaba pasar una corrida que gasta seis
// veces lo declarado. El tope duro de mitad de corrida sí usaba tarifas
// reales, o sea que el freno funcionaba y el AVISO mentía: te enterabas
// cuando la batería se paraba a medias, no antes de arrancar.
//
// El perfil de tokens sale de la corrida completa del 2026-08-28: ~45k de
// entrada y ~3.5k de salida por caso, medidos. Multiplicado por la tarifa del
// papel `agent` para que cambiar de modelo mueva el estimado solo.
// 🔴 RECALIBRADO el 2026-08-30 sobre 64 turnos reales, y con la CACHÉ dentro.
// El perfil anterior (45k entrada, 3.5k salida) ignoraba que la mayor parte de
// la entrada llega cacheada — y cacheado cuesta 30x menos. Medido: 67.118 de
// entrada por turno de los que 41.168 vienen de caché (61%), y 922 de salida,
// no 3.500. El estimado decía 7,3¢ por caso y el real es ~4¢.
//
// Un estimado que ignora la caché no es conservador, es una puerta que cierra
// corridas que sí se podían pagar.
const TOKENS_TIPICOS = { entrada: 67_118, cacheada: 41_168, salida: 922 } as const;
const tarifaAgente = rateFor(modelIdForRole("agent"));
const COST_PER_CASE_USD =
  ((TOKENS_TIPICOS.entrada - TOKENS_TIPICOS.cacheada) * tarifaAgente.input
    + TOKENS_TIPICOS.cacheada * tarifaAgente.cached
    + TOKENS_TIPICOS.salida * tarifaAgente.output) / 1e6;

function realCostUsd(rs: EvalRunResult[]): number {
  let usd = 0;
  for (const r of rs) {
    const rate = rateFor(r.modelId);
    // 🔴 LOS CACHEADOS SON UN SUBCONJUNTO DE LA ENTRADA, NO UN EXTRA.
    //
    // Esto cobraba `inputTokens` ENTERO a precio sin cachear y encima sumaba
    // `cachedTokens` aparte — o sea la parte cacheada dos veces, y la cara las
    // dos. `lib/credits.ts` lo advierte en mayúsculas justo encima de
    // `creditsForUsage`, que sí resta; el que cobra de verdad estaba bien y el
    // que MIDE estaba mal.
    //
    // MEDIDO el 2026-08-30 cuadrando contra la factura: 4,35M tokens nuestros
    // contra 4,7M que reporta Fireworks (1,08x, la diferencia son las llamadas
    // de visión) y $2,54 reales — mientras este cálculo decía $5,90. Con 74%
    // de acierto de caché el error es de más del doble.
    //
    // No era sólo un número feo en pantalla: LA PUERTA DEL PRESUPUESTO se
    // calcula con esto. Una batería que había gastado ~$1,6 se paraba sola
    // creyendo que iba por $3,65, y el tope que existe para no gastar de más
    // acababa impidiendo correr lo que sí se podía pagar.
    const sinCachear = Math.max(0, r.inputTokens - r.cachedTokens);
    usd += (sinCachear * rate.input
      + r.cachedTokens * rate.cached
      + r.outputTokens * rate.output) / 1e6;
    usd += ((r.visual?.visionInputTokens ?? 0) * VISION_RATE.input
      + (r.visual?.visionOutputTokens ?? 0) * VISION_RATE.output) / 1e6;
  }
  return usd;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  const val = (flag: string) => {
    const hit = get(flag);
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? "" : hit.slice(eq + 1);
  };
  return {
    all: !!get("--all"),
    canary: !!get("--canary"),
    limit: val("--limit"),
    only: val("--only"),
    yes: !!get("--yes"),
    costly: !!get("--costly"),
    visual: !!get("--visual"),
    budgetUsd: val("--budget-usd"),
  };
}

function selectCases(args: ReturnType<typeof parseArgs>): EvalCase[] {
  const modes = [args.all, args.canary, args.limit !== undefined, args.only !== undefined].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    fail("Elige EXACTAMENTE un modo de selección: --all | --canary | --limit=N | --only=id1,id2");
  }

  let selected: EvalCase[];
  if (args.all) {
    selected = [...EVAL_CASES];
  } else if (args.canary) {
    const known = new Set(EVAL_CASES.map((c) => c.id));
    for (const id of CANARY_IDS) {
      if (!known.has(id)) fail(`--canary: CANARY_IDS desincronizado — id desconocido "${id}"`);
    }
    const canarySet = new Set<string>(CANARY_IDS);
    selected = EVAL_CASES.filter((c) => canarySet.has(c.id));
  } else if (args.only !== undefined) {
    const ids = new Set(
      args.only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const known = new Set(EVAL_CASES.map((c) => c.id));
    for (const id of ids) if (!known.has(id)) fail(`--only: id desconocido "${id}"`);
    selected = EVAL_CASES.filter((c) => ids.has(c.id));
  } else {
    const n = Number(args.limit);
    if (!Number.isInteger(n) || n < 1) fail(`--limit debe ser un entero ≥ 1 (recibí "${args.limit}")`);
    selected = EVAL_CASES.slice(0, n);
  }

  if (!args.costly) {
    const before = selected.length;
    selected = selected.filter((c) => !c.costly);
    const skipped = before - selected.length;
    if (skipped > 0) {
      console.log(`(omitiendo ${skipped} caso(s) costly — usa --costly para incluirlos)`);
    }
  }
  return selected;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** La celda del eje visual: "-" no mutó, "ok" limpio, "fix→ok" los ojos
 *  arreglaron, "ROTA" el estado final quedó con rotura, "s/j" sin juicio
 *  (fallback del crítico). */
function visualCell(r: EvalRunResult): string {
  if (!r.visual) return "-";
  if (r.visual.fallback && !r.visual.broken) return "s/j";
  if (r.visual.broken) return "ROTA";
  return r.visual.fixedBySelf ? "fix→ok" : "ok";
}

function printTable(results: EvalRunResult[], visual: boolean): void {
  const rows = results.map((r) => ({
    id: r.id,
    verdict: r.pass ? "PASS" : "FAIL",
    vis: visual ? visualCell(r) : "",
    reason: r.reason ? truncate(r.reason, 52) : "",
    tokens: `${r.inputTokens}/${r.cachedTokens}/${r.outputTokens}`,
    s: r.seconds.toFixed(1),
  }));
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    verdict: 4,
    vis: visual ? Math.max(6, ...rows.map((r) => r.vis.length)) : 0,
    reason: Math.max(6, ...rows.map((r) => r.reason.length)),
    tokens: Math.max(14, ...rows.map((r) => r.tokens.length)),
    s: Math.max(4, ...rows.map((r) => r.s.length)),
  };
  const pad = (s: string, w: number) => s.padEnd(w);
  const line = (r: (typeof rows)[number]) =>
    `${pad(r.id, widths.id)}  ${pad(r.verdict, widths.verdict)}  ${
      visual ? `${pad(r.vis, widths.vis)}  ` : ""
    }${pad(r.reason, widths.reason)}  ${pad(r.tokens, widths.tokens)}  ${pad(r.s, widths.s)}`;

  console.log("");
  console.log(
    line({
      id: "id",
      verdict: "res.",
      vis: visual ? "visual" : "",
      reason: "razón",
      tokens: "in/cached/out",
      s: "seg",
    }),
  );
  console.log(
    "-".repeat(
      widths.id + widths.verdict + (visual ? widths.vis + 2 : 0) + widths.reason + widths.tokens + widths.s + 8,
    ),
  );
  for (const r of rows) console.log(line(r));
}

async function main(): Promise<void> {
  // Aqui se exigia `GEMINI_API_KEY`. Es la MISMA guarda falsa que mataba
  // `redisenar_pagina`: el Agente corre en Fireworks y esta clave no la toca
  // nadie, asi que una caja sin ella no podia correr sus propios evals.
  if (!process.env.FIREWORKS_API_KEY?.trim()) {
    fail("FIREWORKS_API_KEY missing — pasa --env-file=.env.local a tsx (npm run evals:agent lo hace).");
  }

  const args = parseArgs(process.argv.slice(2));
  const cases = selectCases(args);
  if (cases.length === 0) fail("No quedó ningún caso por correr.");

  const est = cases.length * (COST_PER_CASE_USD + (args.visual ? COST_PER_CASE_VISUAL_USD : 0));
  const budget = args.budgetUsd !== undefined ? Number(args.budgetUsd) : DEFAULT_BUDGET_USD;
  if (!Number.isFinite(budget) || budget <= 0) {
    fail(`--budget-usd debe ser un número > 0 (recibí "${args.budgetUsd}")`);
  }
  console.log(`\nCasos seleccionados: ${cases.length}`);
  // ⚠️ EL ESTIMADO ES UNA MEDIA, NO UNA COTA. `COST_PER_CASE_USD` sale del
  // perfil TÍPICO, y los casos de la batería varían 6x entre sí: los dos
  // atascos (hero-terror, honesto-navidena) mueven ~250k tokens contra los 45k
  // de la media. Medido el 2026-08-28 con `--only` sobre esos dos: estimado
  // $0.15, gasto real $0.307 — el doble.
  //
  // Quien protege es el tope de gasto REAL de mitad de corrida (más abajo),
  // que sí usa tokens medidos y paró la corrida en $0.31. Esto sólo orienta.
  // Se deja como media a propósito: un perfil por caso sería maquinaria para
  // ganar poco, y el freno de verdad ya está puesto.
  console.log(
    `Costo estimado: ~$${est.toFixed(2)} USD (${cases.length} × ~${(COST_PER_CASE_USD * 100).toFixed(1)}¢/caso` +
      ` en ${modelIdForRole("agent").split("/").pop()})`,
  );
  console.log(`Tope de gasto: $${budget.toFixed(2)} USD${args.budgetUsd === undefined ? " (default — sube el techo con --budget-usd=N)" : ""}`);
  if (args.costly) console.log("⚠ --costly: incluye ediciones de imagen pagadas (~4 créditos cada una).");

  // El techo se aplica ANTES que --yes y no se puede saltar con él: --yes
  // confirma que esto gasta dinero; --budget-usd dice CUÁNTO como máximo.
  if (est > budget) {
    fail(
      `RECHAZADO: el estimado ($${est.toFixed(2)}) excede el tope ($${budget.toFixed(2)}).\n` +
        // REDONDEADO HACIA ARRIBA al céntimo, no `toFixed`. Con un estimado de
        // $0.5617 el mensaje decía «--budget-usd=0.56» y esa orden VOLVÍA A SER
        // RECHAZADA: su propio consejo no funcionaba, y el usuario descubre eso
        // gastando un intento.
        `Si de verdad quieres gastar eso, decláralo explícito: --budget-usd=${(Math.ceil(est * 100) / 100).toFixed(2)}`,
    );
  }

  if (!args.yes) {
    console.log("\nEsto GASTA dinero real del proveedor que corra el turno. Vuelve a correr con --yes para confirmar.");
    process.exit(2);
  }

  const owner = await resolveEvalUser();
  console.log(`Owner: ${owner.email} (${owner.id})\n`);

  const results: EvalRunResult[] = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c.id} … `);
    const started = Date.now();
    let r: EvalRunResult;
    try {
      r = await runEvalCase(c, {
        userId: owner.id,
        ownerEmail: owner.email,
        visual: args.visual,
      });
    } catch (err) {
      // runEvalCase's internal try/catch (harness.ts) wraps the loop run +
      // re-read, but the fixture `setup` mutator and createThrowawayProject
      // run BEFORE that try opens — a throw there (a bad fixture, a DB
      // hiccup) escapes runEvalCase uncaught. Never let one case's exception
      // abort the rest of the battery — register it as a FAIL and continue.
      r = {
        id: c.id,
        pass: false,
        reason: `excepción no capturada: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        modelId: "",
        seconds: (Date.now() - started) / 1000,
      };
    }
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"} (${r.seconds.toFixed(1)}s)${r.pass ? "" : ` — ${r.reason}`}`);

    // Vigilancia del gasto REAL (tokens medidos, no el estimado): al tocar el
    // techo, la batería se detiene aquí — casos restantes SIN correr. Una
    // batería incompleta se re-corre; una cuenta vaciada se paga.
    const spent = realCostUsd(results);
    if (spent >= budget) {
      const remaining = cases.length - results.length;
      console.log(
        `\n⛔ TOPE ALCANZADO: gasto real acumulado $${spent.toFixed(2)} ≥ tope $${budget.toFixed(2)} — ` +
          `deteniendo la batería (${remaining} caso(s) sin correr).`,
      );
      break;
    }
  }

  printTable(results, args.visual);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} PASS (de ${cases.length} seleccionados)`);
  if (args.visual) {
    const judged = results.filter((r) => r.visual);
    const clean = judged.filter((r) => r.visual && !r.visual.broken && !r.visual.fallback).length;
    const fixed = judged.filter((r) => r.visual?.fixedBySelf).length;
    const broken = judged.filter((r) => r.visual?.broken).length;
    const noJudge = judged.filter((r) => r.visual?.fallback && !r.visual.broken).length;
    console.log(
      `Eje visual: ${judged.length} caso(s) mutaron el documento — ${clean} limpios (${fixed} auto-arreglados por los ojos), ${broken} ROTOS, ${noJudge} sin juicio (fallback).`,
    );
  }
  console.log(
    `Costo real de esta corrida: ~$${realCostUsd(results).toFixed(3)} USD (tokens medidos × la tarifa del modelo que corrió cada caso)`,
  );
  if (passed < results.length || results.length < cases.length) process.exit(1);
}

main().catch((err: unknown) => {
  // A clean, single fatal-error print + non-zero exit — never a raw
  // unhandledRejection stack dump that leaves the process hanging.
  console.error("agent-eval: fatal error");
  console.error(err);
  process.exit(1);
});
