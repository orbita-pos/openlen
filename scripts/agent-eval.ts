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

const COST_PER_CASE_USD = 0.03; // ~3¢/case (a costly image-edit case runs more)
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
const RATES_PER_M = {
  "gemini-2.5-flash": { input: 0.3, cached: 0.075, output: 2.5 },
  "accounts/fireworks/models/deepseek-v4-flash-0731": { input: 0.14, cached: 0.028, output: 0.28 },
} as const;
const VISION_RATE = RATES_PER_M["gemini-2.5-flash"];

function rateFor(modelId: string): { input: number; cached: number; output: number } {
  // Un modelo desconocido se cobra al MÁS CARO que conocemos: equivocarse hacia
  // arriba detiene la batería antes de tiempo; hacia abajo, vacía la cuenta.
  return RATES_PER_M[modelId as keyof typeof RATES_PER_M] ?? RATES_PER_M["gemini-2.5-flash"];
}

function realCostUsd(rs: EvalRunResult[]): number {
  let usd = 0;
  for (const r of rs) {
    const rate = rateFor(r.modelId);
    usd += (r.inputTokens * rate.input + r.cachedTokens * rate.cached + r.outputTokens * rate.output) / 1e6;
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
  const key = process.env.GEMINI_API_KEY;
  if (!key) fail("GEMINI_API_KEY missing — pasa --env-file=.env.local a tsx (npm run evals:agent lo hace).");

  const args = parseArgs(process.argv.slice(2));
  const cases = selectCases(args);
  if (cases.length === 0) fail("No quedó ningún caso por correr.");

  const est = cases.length * (COST_PER_CASE_USD + (args.visual ? COST_PER_CASE_VISUAL_USD : 0));
  const budget = args.budgetUsd !== undefined ? Number(args.budgetUsd) : DEFAULT_BUDGET_USD;
  if (!Number.isFinite(budget) || budget <= 0) {
    fail(`--budget-usd debe ser un número > 0 (recibí "${args.budgetUsd}")`);
  }
  console.log(`\nCasos seleccionados: ${cases.length}`);
  console.log(`Costo estimado: ~$${est.toFixed(2)} USD (${cases.length} × ~${(COST_PER_CASE_USD * 100).toFixed(0)}¢/caso)`);
  console.log(`Tope de gasto: $${budget.toFixed(2)} USD${args.budgetUsd === undefined ? " (default — sube el techo con --budget-usd=N)" : ""}`);
  if (args.costly) console.log("⚠ --costly: incluye ediciones de imagen pagadas (~4 créditos cada una).");

  // El techo se aplica ANTES que --yes y no se puede saltar con él: --yes
  // confirma que esto gasta dinero; --budget-usd dice CUÁNTO como máximo.
  if (est > budget) {
    fail(
      `RECHAZADO: el estimado ($${est.toFixed(2)}) excede el tope ($${budget.toFixed(2)}).\n` +
        `Si de verdad quieres gastar eso, decláralo explícito: --budget-usd=${est.toFixed(2)}`,
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
        apiKey: key,
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
    `Costo real de esta corrida: ~$${realCostUsd(results).toFixed(3)} USD (tokens medidos × precios de gemini-2.5-flash)`,
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
