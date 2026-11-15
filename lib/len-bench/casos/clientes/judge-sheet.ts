// lib/len-bench/casos/clientes/judge-sheet.ts — THE JUDGE'S CALIBRATION SHEET (plan local 2026-11-15, task 10).
//
// Spec local 2026-11-12-len-3-1-ruta, §9 row 7 (Anthropic's eval health checklist): the judge is «calibrado
// contra etiquetas humanas (~90 %)» and «probado con vacío, "no sé" y una respuesta a otra pregunta». This writes
// what the judge would see for ~15 customer cases —their requests and their final page in production— with a box
// for Jesús to label PASS or FAIL by hand, and the three sanity entries the judge must fail. Asking the judge
// about the same entries is the first PAID step (a few cents at most), with its own command and cap.
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

/** Every page of a state, home first: the judge reads the whole published site. */
const allHtml = (d: DatosDelCaso): string => [d.html ?? "", ...Object.values(d.pages ?? {}).map((p) => p.html)].join("\n");

const section = (title: string, view: string) => `## ${title}\n\n\`\`\`text\n${view}\n\`\`\`\n\nTu etiqueta: [ ] PASS · [ ] FAIL\n`;

/** The sheet, as markdown: the criterion once, up to `max` cases, then the sanity entries. */
export function judgeSheet(cases: readonly FetchedCase[], max = 15): string {
  const picked = cases.slice(0, max);
  const parts = [
    `# Calibración del juez — batería 1 de Len 3.1\n\nCriterio (el mismo para todos):\n\n> ${CUMPLE_LO_PEDIDO}\n\n` +
      `Marca cada caso como lo marcarías tú. El juez vota sólo si coincide contigo en ~90 %.\n`,
    ...picked.map((c, i) =>
      section(`${i + 1}. cliente-${c.projectId.slice(0, 8)}`, pedidosYPagina(c.ownerMessages.map((texto) => ({ quien: "dueno", texto })), allHtml(c.final))),
    ),
    ...SANITY_ENTRIES.map((s) => section(`cordura · ${s.nombre} · esperado: FAIL`, pedidosYPagina(s.pedidos.map((texto) => ({ quien: "dueno", texto })), s.html))),
  ];
  return parts.join("\n");
}
