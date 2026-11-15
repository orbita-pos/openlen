// npm run bench:clientes:hoja — writes the judge's calibration sheet of Len 3.1's battery 1 (plan local
// 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 10) into the cases' folder, OUTSIDE the repo: it carries
// customers' words. $0: it reads the fetched cases, paints each final page in a local Chromium (as the judge reads it
// in a run) and writes a file; it asks no model. Prints only where it wrote.
//   --reserva   the held-out sheet (calibracion-reserva.md): the cases after the first 15 (judge-sheet.ts `sheetCases`)
import fs from "node:fs";
import path from "node:path";

import { casesDir, readFetchedCase } from "../lib/len-bench/casos/clientes/fetched";
import { judgeSheet, sheetCases } from "../lib/len-bench/casos/clientes/judge-sheet";
import { renderedText } from "../lib/len-bench/casos/clientes/rendered";
import { lanzarNavegador } from "../lib/len-bench/navegador";

async function main(): Promise<void> {
  const ids = (JSON.parse(fs.readFileSync("lib/len-bench/casos/clientes/cases.json", "utf8")) as { projectId: string }[]).map((c) => c.projectId);
  const navegador = await lanzarNavegador();
  try {
    // cases.json is ordered most recent first: the sheet takes the 15 most recent, the held-out sheet the rest.
    const which = process.argv.includes("--reserva") ? "reserva" : "hoja";
    const cases = sheetCases(ids, which).map(readFetchedCase);
    const sheet = await judgeSheet(cases, (d) => renderedText(navegador, d), cases.length);
    const file = path.join(casesDir(), which === "hoja" ? "calibracion.md" : "calibracion-reserva.md");
    fs.writeFileSync(file, sheet);
    console.log(`hoja de calibración: ${file} (${cases.length} casos + 3 de cordura)`);
  } finally {
    await navegador.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
