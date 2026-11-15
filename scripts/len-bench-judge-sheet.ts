// npm run bench:clientes:hoja — writes the judge's calibration sheet of Len 3.1's battery 1 (plan local
// 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 10) into the cases' folder, OUTSIDE the repo: it carries
// customers' words. $0: it reads the fetched cases and writes a file; it asks no model. Prints only where it wrote.
import fs from "node:fs";
import path from "node:path";

import { casesDir, readFetchedCase } from "../lib/len-bench/casos/clientes/fetched";
import { judgeSheet } from "../lib/len-bench/casos/clientes/judge-sheet";

const ids = (JSON.parse(fs.readFileSync("lib/len-bench/casos/clientes/cases.json", "utf8")) as { projectId: string }[]).map((c) => c.projectId);
// cases.json is ordered most recent first: the sheet takes the 15 most recent.
const sheet = judgeSheet(ids.map(readFetchedCase));
const file = path.join(casesDir(), "calibracion.md");
fs.writeFileSync(file, sheet);
console.log(`hoja de calibración: ${file} (${Math.min(15, ids.length)} casos + 3 de cordura)`);
