// npx tsx --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs \
//   scripts/len-bench-regrade-told.ts --from=<column folder> --to=<new folder> [--juego=clientes]
//
// RE-GRADES A COLUMN ALREADY RUN with the revised `nada-inventado` (16/11, battery 1 of Len 3.1): $0, no model, no
// page — `regradeToldPlaceholders` (lib/len-bench/regrade-told.ts) works from the grader's explanation and the saved
// conversation. Writes a NEW folder (the original is never touched) with the runs re-graded and the evaluator
// fingerprint of the code as it is now, computed as `scripts/len-bench.ts` does: a candidate run with
// `--base-de=<new folder>` compares with no `--aprobar-evaluador`. No `gasto.json`: no money was spent here.
import fs from "node:fs";
import path from "node:path";
import { cargarEncargos, type Juego } from "@/lib/len-bench/casos/cargar";
import { EVALUATOR_SOURCES, evaluatorFingerprint, evaluatorPartsOf, writeEvaluatorFile } from "@/lib/len-bench/evaluator-fingerprint";
import { judgeIdentity } from "@/lib/len-bench/juez";
import { regradeToldPlaceholders } from "@/lib/len-bench/regrade-told";
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
  let changed = 0;
  let nowPassing = 0;
  const files = fs.readdirSync(runsFrom).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const before = JSON.parse(fs.readFileSync(path.join(runsFrom, f), "utf8")) as ResultadoDeCorrida;
    const after = regradeToldPlaceholders(before);
    if (after !== before) changed++;
    if (after.score >= 1 && before.score < 1) nowPassing++;
    fs.writeFileSync(path.join(runsTo, f), `${JSON.stringify(after, null, 2)}\n`);
  }
  writeEvaluatorFile(to, { huella, judgeModel: judge.model, cases: encargos.length });
  console.log(`${files.length} corridas · ${changed} recalificadas · ${nowPassing} pasan ahora a 1,00 · evaluador ${huella}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
