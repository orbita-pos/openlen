// lib/len-bench/casos/clientes/judge-sheet.ts — THE JUDGE'S CALIBRATION SHEET (plan local 2026-11-15, task 10).
//
// Spec local 2026-11-12-len-3-1-ruta, §9 row 7 (Anthropic's eval health checklist): the judge is «calibrado
// contra etiquetas humanas (~90 %)» and «probado con vacío, "no sé" y una respuesta a otra pregunta». This writes
// what the judge would see for ~15 customer cases —their requests and their final page in production, PAINTED as a
// visitor sees it, exactly as the judge reads it in a run (rendered.ts)— with a box for a reference label, and the
// three sanity entries the judge must fail. `sheetEntries` is also what the calibration asks the judge
// (calibration.ts): the sheet and the questions are the same.
import { pedidosYPagina } from "../../juez";
import type { DatosDelCaso } from "../../tipos";
import type { FetchedCase } from "./fetched";
import { CUMPLE_LO_PEDIDO } from "./rubric";

/** The three entries the judge must FAIL, whatever the case: nothing, «I don't know», an answer to another request. */
export const SANITY_ENTRIES: readonly { readonly nombre: string; readonly pedidos: readonly string[]; readonly html: string }[] = [
  { nombre: "pagina-vacia", pedidos: ["hazme una página para mi panadería con el horario y el teléfono"], html: "" },
  { nombre: "no-se", pedidos: ["hazme una página para mi panadería con el horario y el teléfono"], html: "<body><p>No sé.</p></body>" },
  {
    nombre: "otra-peticion",
    pedidos: ["hazme una página para mi panadería con el horario y el teléfono"],
    html: "<body><h1>Taller mecánico</h1><p>Afinación y frenos. Cotiza tu servicio.</p></body>",
  },
];

/** The visible text of every page of a state, home first: `renderedText` with a browser, a stand-in in tests. */
export type Painter = (d: DatosDelCaso) => Promise<string>;

const viewOf = (pedidos: readonly string[], texto: string) => pedidosYPagina(pedidos.map((t) => ({ quien: "dueno", texto: t })), texto);

export interface SheetEntry {
  /** `cliente-<8 hex>` for a real case, `cordura-<name>` for a sanity entry. */
  readonly caso: string;
  readonly cordura: boolean;
  /** Exactly what the judge is shown (the `pedidos_y_pagina` focus). */
  readonly view: string;
}

/** Up to `max` customer cases (the most recent first, as cases.json), then the sanity entries, all painted alike. */
export async function sheetEntries(cases: readonly FetchedCase[], paint: Painter, max = 15): Promise<SheetEntry[]> {
  const out: SheetEntry[] = [];
  for (const c of cases.slice(0, max)) {
    out.push({ caso: `cliente-${c.projectId.slice(0, 8)}`, cordura: false, view: viewOf(c.ownerMessages, await paint(c.final)) });
  }
  for (const s of SANITY_ENTRIES) {
    out.push({ caso: `cordura-${s.nombre}`, cordura: true, view: viewOf(s.pedidos, await paint({ html: s.html })) });
  }
  return out;
}

const section = (title: string, view: string) => `## ${title}\n\n\`\`\`text\n${view}\n\`\`\`\n\nTu etiqueta: [ ] PASS · [ ] FAIL\n`;

/** The sheet, as markdown: the criterion once, up to `max` cases, then the sanity entries. */
export async function judgeSheet(cases: readonly FetchedCase[], paint: Painter, max = 15): Promise<string> {
  let n = 0;
  const entries = await sheetEntries(cases, paint, max);
  return [
    `# Calibración del juez — batería 1 de Len 3.1\n\nCriterio (el mismo para todos):\n\n> ${CUMPLE_LO_PEDIDO}\n\n` +
      `Marca cada caso como lo marcarías tú. El juez vota sólo si coincide contigo en ~90 %.\n`,
    ...entries.map((e) =>
      e.cordura ? section(`cordura · ${e.caso.replace(/^cordura-/, "")} · esperado: FAIL`, e.view) : section(`${++n}. ${e.caso}`, e.view),
    ),
  ].join("\n");
}
