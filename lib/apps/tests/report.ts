// lib/apps/tests/report.ts — EL INFORME DE `npm test` (plan 04): el de vitest,
// el que el modelo ha leído millones de veces — capturado de vitest de verdad
// con NO_COLOR (está en el plan, «Lo medido»). Sin colores ni hora de pared en
// la duración; `Start at` es la hora local. Sale con 1 si algo falló, si un
// fichero no cargó o si no había pruebas. Sin tiempo para todo, lo que vitest
// imprime hasta que lo matan (la cabecera y los ficheros acabados): el comando
// se corta como en Claude Code (`timedOut`, 143).
import { TEST_INCLUDE } from "./test-files";
import type { TestFailure, TestFileResult, TestRun } from "./run-tests";

const VERSION = "4.1.11";
const SEP = "⎯";

const sinBarra = (r: string) => r.replace(/^\//, "");
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
const hora = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
const duracion = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);

function marco(fuente: string | undefined, linea: number, columna: number): string[] {
  if (fuente === undefined) return [];
  const lineas = fuente.split("\n");
  const out: string[] = [];
  for (let n = Math.max(1, linea - 2); n <= Math.min(lineas.length, linea + 2); n++) {
    // Como vitest: el número a 7 de ancho, y bajo la línea del fallo el `^` en su columna.
    out.push(`${String(n).padStart(7)}| ${lineas[n - 1]}`);
    if (n === linea) out.push(`${" ".repeat(7)}| ${" ".repeat(Math.max(0, columna - 1))}^`);
  }
  return out;
}

function bloqueDeFallo(e: TestFailure, sources: Readonly<Record<string, string>>): string[] {
  const out = [`${e.name}: ${e.message}`];
  if (e.diff) out.push("", ...e.diff.split("\n"));
  if (e.site) out.push("", ` ❯ ${sinBarra(e.site.ruta)}:${e.site.linea}:${e.site.columna}`, ...marco(sources[e.site.ruta], e.site.linea, e.site.columna));
  return out;
}

export function formatVitestReport(
  run: TestRun,
  sources: Readonly<Record<string, string>>,
  now = new Date(),
): { stdout: string; exitCode: number; timedOut?: true } {
  if (run.files.length === 0 && run.notRun.length === 0) {
    return { stdout: `\nNo test files found, exiting with code 1\n\ninclude: ${TEST_INCLUDE}\n`, exitCode: 1 };
  }
  const out: string[] = ["", ` RUN  v${VERSION} /`, ""];
  const fallidos: { f: TestFileResult; nombre: string[]; e: TestFailure }[] = [];
  const suitesRotas: TestFileResult[] = [];
  for (const f of run.files) {
    const ruta = sinBarra(f.file);
    const n = f.tests.length;
    const mal = f.tests.filter((t) => t.state === "fail");
    const saltadas = f.tests.filter((t) => t.state === "skip" || t.state === "todo").length;
    const roto = f.fileError !== null || mal.length > 0;
    // Todo saltado (un -t que no casa): `↓` y sin ms, como vitest (medido en la 2.1.9).
    const saltado = !roto && n > 0 && saltadas === n;
    const partes = [plural(n, "test").replace(/^0 tests$/, "0 test"), mal.length ? `${mal.length} failed` : "", saltadas ? `${saltadas} skipped` : ""].filter(Boolean);
    out.push(` ${roto ? "❯" : saltado ? "↓" : "✓"} ${ruta} (${partes.join(" | ")})${f.fileError || saltado ? "" : ` ${f.ms}ms`}`);
    for (const t of mal) {
      out.push(`   × ${t.name.join(" > ")} ${t.ms}ms`, `     → ${t.error!.message.split("\n")[0]}`);
      fallidos.push({ f, nombre: [...t.name], e: t.error! });
    }
    if (f.fileError) suitesRotas.push(f);
  }
  if (run.notRun.length > 0) return { stdout: out.join("\n") + "\n", exitCode: 143, timedOut: true };
  const total = suitesRotas.length + fallidos.length;
  let i = 0;
  if (suitesRotas.length > 0) {
    out.push("", `${SEP.repeat(6)} Failed Suites ${suitesRotas.length} ${SEP.repeat(7)}`, "");
    for (const f of suitesRotas) {
      i++;
      out.push(` FAIL  ${sinBarra(f.file)} [ ${sinBarra(f.file)} ]`, ...bloqueDeFallo(f.fileError!, sources), "", `${SEP.repeat(24)}[${i}/${total}]${SEP}`, "");
    }
  }
  if (fallidos.length > 0) {
    out.push("", `${SEP.repeat(7)} Failed Tests ${fallidos.length} ${SEP.repeat(7)}`, "");
    for (const { f, nombre, e } of fallidos) {
      i++;
      out.push(` FAIL  ${sinBarra(f.file)} > ${nombre.join(" > ")}`, ...bloqueDeFallo(e, sources), "", `${SEP.repeat(24)}[${i}/${total}]${SEP}`, "");
    }
  }
  const sinManejar = run.files.flatMap((f) => f.unhandled);
  if (sinManejar.length > 0) {
    out.push(`${SEP.repeat(7)} Unhandled Errors ${SEP.repeat(7)}`, "", `Vitest caught ${plural(sinManejar.length, "unhandled error")} during the test run.`, "This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.", "");
    for (const e of sinManejar) out.push(...bloqueDeFallo(e, sources), "");
  }
  const ficherosMal = run.files.filter((f) => f.fileError || f.tests.some((t) => t.state === "fail")).length;
  const ficherosSaltados = run.files.filter((f) => !f.fileError && f.tests.length > 0 && f.tests.every((t) => t.state === "skip" || t.state === "todo")).length;
  const ficherosBien = run.files.length - ficherosMal - ficherosSaltados;
  const todas = run.files.flatMap((f) => f.tests);
  const cuenta = (s: string) => todas.filter((t) => t.state === s).length;
  const lineaFicheros = [ficherosMal ? `${ficherosMal} failed` : "", ficherosBien ? `${ficherosBien} passed` : "", ficherosSaltados ? `${ficherosSaltados} skipped` : ""].filter(Boolean).join(" | ");
  const lineaPruebas =
    todas.length === 0
      ? "no tests"
      : `${[cuenta("fail") ? `${cuenta("fail")} failed` : "", cuenta("pass") ? `${cuenta("pass")} passed` : "", cuenta("skip") ? `${cuenta("skip")} skipped` : "", cuenta("todo") ? `${cuenta("todo")} todo` : ""].filter(Boolean).join(" | ")} (${todas.length})`;
  if (out[out.length - 1] !== "") out.push("");
  out.push(` Test Files  ${lineaFicheros} (${run.files.length})`, `      Tests  ${lineaPruebas}`, `   Start at  ${hora(now)}`, `   Duration  ${duracion(run.ms)}`, "");
  if (run.blocked.length > 0) out.push(`Blocked network requests (tests run in a sandboxed browser): ${run.blocked.join(", ")}`, "");
  // Lo que cortó el guardia se DICE pero no hace fallar: una prueba puede
  // esperar justo eso (Review Focus 4), y si no, ya falló ella.
  const exitCode = ficherosMal > 0 || sinManejar.length > 0 ? 1 : 0;
  return { stdout: out.join("\n"), exitCode };
}
