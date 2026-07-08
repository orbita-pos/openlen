// scripts/agent-eval.ts — the OpenLen Agent's credit-conscious eval runner.
//
//   npm run evals:agent -- --limit=3 --yes
//   npm run evals:agent -- --only=activar-reservas,honesto-carrito --yes
//   npm run evals:agent -- --all --yes            (the full battery — T7)
//   npm run evals:agent -- --all --yes --costly   (include the paid image edit)
//
// Each case spends real Gemini credits, so the runner PRINTS a cost estimate
// first and REFUSES to run without --yes. Concurrency is 1 (shared prod Neon +
// rate limits). Exit code is non-zero if any case fails, so it can gate a
// commit. Owner is resolved from EVAL_USER_EMAIL (no default).

import { EVAL_CASES, type EvalCase } from "@/lib/agent/evals/cases";
import { resolveEvalUser, runEvalCase, type EvalRunResult } from "@/lib/agent/evals/harness";

const COST_PER_CASE_USD = 0.03; // ~3¢/case (a costly image-edit case runs more)

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
    limit: val("--limit"),
    only: val("--only"),
    yes: !!get("--yes"),
    costly: !!get("--costly"),
  };
}

function selectCases(args: ReturnType<typeof parseArgs>): EvalCase[] {
  const modes = [args.all, args.limit !== undefined, args.only !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    fail("Elige EXACTAMENTE un modo de selección: --all | --limit=N | --only=id1,id2");
  }

  let selected: EvalCase[];
  if (args.all) {
    selected = [...EVAL_CASES];
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

function printTable(results: EvalRunResult[]): void {
  const rows = results.map((r) => ({
    id: r.id,
    verdict: r.pass ? "PASS" : "FAIL",
    reason: r.reason ? truncate(r.reason, 52) : "",
    tokens: `${r.inputTokens}/${r.cachedTokens}/${r.outputTokens}`,
    s: r.seconds.toFixed(1),
  }));
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    verdict: 4,
    reason: Math.max(6, ...rows.map((r) => r.reason.length)),
    tokens: Math.max(14, ...rows.map((r) => r.tokens.length)),
    s: Math.max(4, ...rows.map((r) => r.s.length)),
  };
  const pad = (s: string, w: number) => s.padEnd(w);
  const line = (r: (typeof rows)[number]) =>
    `${pad(r.id, widths.id)}  ${pad(r.verdict, widths.verdict)}  ${pad(r.reason, widths.reason)}  ${pad(
      r.tokens,
      widths.tokens,
    )}  ${pad(r.s, widths.s)}`;

  console.log("");
  console.log(
    line({
      id: "id",
      verdict: "res.",
      reason: "razón",
      tokens: "in/cached/out",
      s: "seg",
    }),
  );
  console.log("-".repeat(widths.id + widths.verdict + widths.reason + widths.tokens + widths.s + 8));
  for (const r of rows) console.log(line(r));
}

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) fail("GEMINI_API_KEY missing — pasa --env-file=.env.local a tsx (npm run evals:agent lo hace).");

  const args = parseArgs(process.argv.slice(2));
  const cases = selectCases(args);
  if (cases.length === 0) fail("No quedó ningún caso por correr.");

  const estUsd = (cases.length * COST_PER_CASE_USD).toFixed(2);
  console.log(`\nCasos seleccionados: ${cases.length}`);
  console.log(`Costo estimado: ~$${estUsd} USD (${cases.length} × ~${(COST_PER_CASE_USD * 100).toFixed(0)}¢/caso)`);
  if (args.costly) console.log("⚠ --costly: incluye ediciones de imagen pagadas (~4 créditos cada una).");

  if (!args.yes) {
    console.log("\nEsto GASTA créditos reales de Gemini. Vuelve a correr con --yes para confirmar.");
    process.exit(2);
  }

  const owner = await resolveEvalUser();
  console.log(`Owner: ${owner.email} (${owner.id})\n`);

  const results: EvalRunResult[] = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c.id} … `);
    const r = await runEvalCase(c, { userId: owner.id, ownerEmail: owner.email, apiKey: key });
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"} (${r.seconds.toFixed(1)}s)${r.pass ? "" : ` — ${r.reason}`}`);
  }

  printTable(results);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} PASS`);
  if (passed < results.length) process.exit(1);
}

void main();
