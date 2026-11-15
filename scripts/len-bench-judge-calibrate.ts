// npm run bench:clientes:calibrar — CALIBRATES Len-Bench's judge on the sheet of Len 3.1's battery 1 (spec local
// 2026-11-12-len-3-1-ruta, §9 row 7): the same entries as the sheet (painted in a local Chromium), asked to the judge
// exactly as in a run (`judgeVerdict`: same prompt, three votes, majority), compared with the reference labels.
//
//   npm run bench:clientes:calibrar                                  → $0: paints, checks the labels, prints the estimate
//   npm run bench:clientes:calibrar -- --budget-usd=0.05 --yes       → asks the judge, never past the cap
//   … --reserva            the held-out sheet (the cases after the first 15): labels etiquetas-fable-reserva.json,
//                          result calibracion-reserva-resultado.json
//   … --etiquetas=<file>   the labels (default: etiquetas-fable.json in the cases' folder)
//
// Writes calibracion-resultado.json next to the cases (ids, verdicts and votes: no customer text) and prints only ids,
// percentages and dollars. Spending needs both flags: the estimate is printed first, and Jesús says yes to it.
import fs from "node:fs";
import path from "node:path";

import { rateFor } from "@/lib/ai/tarifas-eval";
import { MODEL_POLICY } from "@/lib/generation/model-policy";
import { agreement, estimateCalibrationUsd, type ReferenceLabel } from "../lib/len-bench/casos/clientes/calibration";
import { casesDir, readFetchedCase } from "../lib/len-bench/casos/clientes/fetched";
import { sheetCases, sheetEntries } from "../lib/len-bench/casos/clientes/judge-sheet";
import { renderedText } from "../lib/len-bench/casos/clientes/rendered";
import { CUMPLE_LO_PEDIDO } from "../lib/len-bench/casos/clientes/rubric";
import { gastoDelJuez, judgeIdentity, judgeVerdict } from "../lib/len-bench/juez";
import { lanzarNavegador } from "../lib/len-bench/navegador";

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
};
const key = (caso: string) => caso.replace(/^cordura-/, "");

async function main(): Promise<void> {
  const reserva = process.argv.includes("--reserva");
  const labelsFile = arg("--etiquetas") || path.join(casesDir(), reserva ? "etiquetas-fable-reserva.json" : "etiquetas-fable.json");
  const labels: ReferenceLabel[] = (JSON.parse(fs.readFileSync(labelsFile, "utf8")) as ReferenceLabel[]).map((l) => ({
    caso: l.caso,
    etiqueta: l.etiqueta,
  }));
  for (const l of labels) if (l.etiqueta !== "PASS" && l.etiqueta !== "FAIL") throw new Error(`etiqueta inválida para ${l.caso}`);

  const ids = (JSON.parse(fs.readFileSync("lib/len-bench/casos/clientes/cases.json", "utf8")) as { projectId: string }[]).map((c) => c.projectId);
  const navegador = await lanzarNavegador();
  let entries;
  try {
    const cases = sheetCases(ids, reserva ? "reserva" : "hoja").map(readFetchedCase);
    entries = await sheetEntries(cases, (d) => renderedText(navegador, d), cases.length);
  } finally {
    await navegador.close();
  }
  const labelled = new Set(labels.map((l) => key(l.caso)));
  const missing = entries.filter((e) => !e.cordura && !labelled.has(key(e.caso))).map((e) => e.caso);
  if (missing.length > 0) throw new Error(`faltan etiquetas: ${missing.join(", ")}`);

  const rate = rateFor(MODEL_POLICY.judge.modelId);
  const estimado = estimateCalibrationUsd(entries, rate);
  console.log(`juez ${judgeIdentity().model} · ${entries.length} entradas × 3 votos · estimado $${estimado.toFixed(4)} · etiquetas ${path.basename(labelsFile)}`);

  const tope = arg("--budget-usd") ? Number(arg("--budget-usd")) : undefined;
  if (tope === undefined || !(tope > 0) || arg("--yes") === undefined) {
    console.log("No se gastó nada. Para preguntar al juez: --budget-usd=<tope> --yes");
    return;
  }
  if (estimado > tope) throw new Error(`RECHAZADO: el estimado ($${estimado.toFixed(4)}) excede el tope ($${tope})`);

  const veredictos: { caso: string; paso: boolean; votos: boolean[] }[] = [];
  let parado = false;
  for (const e of entries) {
    // Never past the cap: the next entry goes only if what it may cost still fits.
    if (gastoDelJuez() + estimateCalibrationUsd([e], rate) > tope) {
      parado = true;
      break;
    }
    const v = await judgeVerdict(CUMPLE_LO_PEDIDO, "pedidos_y_pagina", e.view);
    veredictos.push({ caso: e.caso, paso: v.paso, votos: v.votos });
  }

  const acuerdo = parado ? null : agreement(labels, veredictos);
  const out = path.join(casesDir(), reserva ? "calibracion-reserva-resultado.json" : "calibracion-resultado.json");
  fs.writeFileSync(
    out,
    JSON.stringify(
      { fecha: new Date().toISOString(), hoja: reserva ? "reserva" : "hoja", juez: judgeIdentity().model, etiquetas: path.basename(labelsFile), usd: gastoDelJuez(), completo: !parado, veredictos, acuerdo },
      null,
      2,
    ),
  );
  console.log(`gastado $${gastoDelJuez().toFixed(4)} · ${veredictos.length}/${entries.length} entradas · ${out}`);
  if (acuerdo === null) {
    console.log("PARADO por el tope: sin resultado de calibración.");
    return;
  }
  console.log(`acuerdo ${acuerdo.acuerdo}/${acuerdo.total} = ${acuerdo.pct.toFixed(1)} %`);
  console.log(`FAIL de referencia que el juez también falla: ${acuerdo.fallosAtrapados.atrapados}/${acuerdo.fallosAtrapados.total}`);
  for (const d of acuerdo.desacuerdos) console.log(`  desacuerdo ${d.caso}: etiqueta ${d.etiqueta}, juez ${d.juez}`);
  for (const c of acuerdo.cordura) console.log(`  cordura ${c.caso}: juez ${c.juez}${c.ok ? "" : "  ← tenía que ser FAIL"}`);
  console.log(acuerdo.vota ? "El juez VOTA (≥ 90 % y cordura en FAIL)." : "El juez NO vota todavía.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
