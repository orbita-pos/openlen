// npm run bench:len:tabla -- --base=<carpeta> --candidato=<carpeta> [--juego=clientes] [--base-commit=92f4f7e21] [--candidato-commit=<sha>]
//
// THE LEN 3.1 TABLE (spec local 2026-11-12-len-3-1-ruta, §4) from two columns run with `npm run bench:len`:
// $0 — it reads their `runs/` and prints markdown. If the two columns were graded by different evaluators
// (evaluador.json, evaluator-fingerprint.ts) it says so first: then the table is not a comparison.
import { cargarEncargos, type Juego } from "@/lib/len-bench/casos/cargar";
import { readEvaluatorFile } from "@/lib/len-bench/evaluator-fingerprint";
import { allRuns, columnOf, renderTable, tableRows } from "@/lib/len-bench/table";

function arg(n: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a?.slice(n.length + 1);
}

async function main(): Promise<number> {
  const baseDir = arg("--base");
  const candidateDir = arg("--candidato");
  if (!baseDir || !candidateDir) throw new Error("uso: --base=<carpeta de la columna base> --candidato=<carpeta del candidato>");
  const juego = (arg("--juego") ?? "clientes") as Juego;
  const [hBase, hCand] = [readEvaluatorFile(baseDir), readEvaluatorFile(candidateDir)];
  if (!hBase || !hCand || hBase !== hCand) {
    console.log(`⚠ las dos columnas NO tienen el mismo evaluador (base ${hBase ?? "sin evaluador.json"}, candidato ${hCand ?? "sin evaluador.json"}): esta tabla no compara\n`);
  }
  // Which cases the customer published: the F2 row is read only there.
  const publishingCases = new Set((await cargarEncargos(juego).catch(() => [])).filter((e) => e.publicaLen).map((e) => e.id));
  const rows = tableRows(columnOf(allRuns(baseDir)), columnOf(allRuns(candidateDir)), { publishingCases });
  console.log(renderTable(rows, { base: arg("--base-commit") ?? "92f4f7e21", candidato: arg("--candidato-commit") ?? "candidato" }));
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`len-bench-table: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
