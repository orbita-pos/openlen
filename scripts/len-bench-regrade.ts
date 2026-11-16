// npx tsx --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs \
//   scripts/len-bench-regrade.ts --from=<column folder> --to=<new folder> [--juego=clientes]
//
// RE-GRADES A COLUMN ALREADY RUN with the rules as they are now (16/11, battery 1 of Len 3.1): $0, no model, no
// page (lib/len-bench/regrade.ts). A run the old 20-min clock cut becomes the harness's (`reclassifyBenchClock`), and
// `nada-inventado` accepts the kinds of data Len told the owner were examples (`regradeToldPlaceholders`). Writes a
// NEW folder (the original is never touched) with the runs re-graded, its `infraestructura.json`, and the evaluator
// fingerprint of the code as it is now, computed as `scripts/len-bench.ts` does: a candidate run with
// `--base-de=<new folder>` compares with no `--aprobar-evaluador`. No `gasto.json`: no money was spent here.
import fs from "node:fs";
import path from "node:path";
import { cargarEncargos, type Juego } from "@/lib/len-bench/casos/cargar";
import { EVALUATOR_SOURCES, evaluatorFingerprint, evaluatorPartsOf, writeEvaluatorFile } from "@/lib/len-bench/evaluator-fingerprint";
import { judgeIdentity } from "@/lib/len-bench/juez";
import { DEL_ARNES } from "@/lib/len-bench/puntuar";
import { reclassifyBenchClock, regradeToldPlaceholders } from "@/lib/len-bench/regrade";
import type { ResultadoDeCorrida } from "@/lib/len-bench/tipos";

function arg(n: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a?.slice(n.length + 1);
}

async function main(): Promise<number> {
  const from = arg("--from");
  const to = arg("--to");
  if (!from || !to) throw new Error("hace falta --from=<carpeta de la columna> y --to=<carpeta nueva>");
  if (fs.existsSync(to)) throw new Error(`${to} ya existe: no se sobrescribe`);
  const juego = (arg("--juego") ?? "clientes") as Juego;
  const encargos = await cargarEncargos(juego);
  const judge = judgeIdentity();
  const huella = evaluatorFingerprint(evaluatorPartsOf(encargos, judge, EVALUATOR_SOURCES.map((f) => fs.readFileSync(f, "utf8"))));

  const runsFrom = path.join(from, "runs");
  const runsTo = path.join(to, "runs");
  fs.mkdirSync(runsTo, { recursive: true });
  let told = 0;
  let nowPassing = 0;
  let clock = 0;
  const apart: { caseId: string; run: number; desenlace: string; error?: string }[] = [];
  const files = fs.readdirSync(runsFrom).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const before = JSON.parse(fs.readFileSync(path.join(runsFrom, f), "utf8")) as ResultadoDeCorrida;
    const reclassified = reclassifyBenchClock(before);
    if (reclassified !== before) clock++;
    const after = regradeToldPlaceholders(reclassified);
    if (after !== reclassified) told++;
    if (after.score >= 1 && before.score < 1) nowPassing++;
    fs.writeFileSync(path.join(runsTo, f), `${JSON.stringify(after, null, 2)}\n`);
    const m = /^(.+)-(\d+)\.json$/.exec(f);
    if (m && DEL_ARNES.has(after.desenlace)) apart.push({ caseId: m[1]!, run: Number(m[2]), desenlace: after.desenlace, ...(after.error ? { error: after.error } : {}) });
  }
  // The runs out of the mean, as the runner writes them: `--reanudar=<new folder>` runs them again.
  fs.writeFileSync(path.join(to, "infraestructura.json"), JSON.stringify(apart, null, 2));
  writeEvaluatorFile(to, { huella, judgeModel: judge.model, cases: encargos.length });
  console.log(`${files.length} corridas · ${clock} cortadas por el reloj del banco (aparte) · ${told} con datos que Len dijo de ejemplo · ${nowPassing} pasan ahora a 1,00 · evaluador ${huella}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
