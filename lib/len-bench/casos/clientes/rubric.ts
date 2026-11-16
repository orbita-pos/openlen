// lib/len-bench/casos/clientes/rubric.ts — THE RUBRIC OF BATTERY 1, the same for every customer case.
//
// Plan local 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 9; spec local 2026-11-12-len-3-1-ruta, §5 piece 5:
// «el estado final con los calificadores que Len-Bench ya tiene (la publicada responde y funciona, nada inventado…);
// un criterio con juez por caso como mucho, con foco pequeño». Generic on purpose: a rubric written by hand per
// case would carry the customer's words into a public repository.
import {
  enlacesInternosVan,
  lenPublico,
  nadaInventado,
  ningunEnlaceRoto,
  paginaHecha,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "../../graders";
import { juez } from "../../juez";
import type { DatosDelCaso, Encargo, Grader } from "../../tipos";
import type { FetchedCase } from "./fetched";

/** The judge's one criterion, fixed text: nobody's data in it. It does not vote (`puntua: false`) until it agrees
 *  with the reference labels (~90 %, spec §9 row 7). Calibrated 15/11: 19/23 (82.6 %) against two blind labellers
 *  who agreed 23/24 — so for Len 3.1 it OBSERVES: run and reported, never in the score (Jesús: «27B, advisory
 *  only»; Claude Code's `scored: false`). `npm run bench:clientes:calibrar` says when a judge earns the vote.
 *
 *  Rewritten 15/11 after the first calibration (86.7 %): each «Cómo leerlo» line settles one CLASS of case the
 *  reference labeller itself called ambiguous —never a case's answer—, and is checked on 9 cases neither the
 *  labeller nor the judge had seen (the held-out sheet, judge-sheet.ts `sheetCases`). Two of them say what this
 *  criterion is NOT: what the visible text cannot show, and what the page adds unasked (nada-inventado grades that;
 *  counting it here too would fail a page twice for one defect). */
export const CUMPLE_LO_PEDIDO =
  "Cada cosa concreta que el dueño pidió en sus mensajes numerados está hecha en la página final. Cómo leerlo:\n" +
  "- Lo que pidió y después cambió cuenta en su última versión. Una queja sobre cómo se ve algo no es pedir que se quite: si se quitó, falta.\n" +
  "- Una pregunta que pide algo («¿puedes poner…?») es un pedido; una que sólo pide opinión o información, no. " +
  "Si no pidió nada concreto aparte de su página, basta una página de su negocio.\n" +
  "- Cuenta lo que está aunque no use sus mismas palabras. Lo que se usa con un clic (carrito, formulario, detalle) está hecho " +
  "si la página muestra cómo llegar a ello; si no hay ni rastro, falta.\n" +
  "- Una sección pedida cuyo dato el dueño nunca dio, con un hueco visible para ponerlo, está hecha.\n" +
  "- Sólo ves el texto visible: lo que el texto no puede mostrar (imágenes, colores, letra, diseño, el servidor, ficheros) " +
  "no cuenta ni a favor ni en contra. Lo que la página añade sin que se pidiera tampoco: eso lo califica otro.\n" +
  "Si falta una sola cosa pedida, FAIL.";

export function customerGraders(f: FetchedCase): Grader[] {
  return [
    ...(f.published ? [lenPublico()] : []),
    // The battery's null (review C1): without it a blank page passed every voting grader.
    paginaHecha(),
    nadaInventado(),
    sinCifrasInventadas(),
    sinDesbordeMovil(),
    enlacesInternosVan(),
    ningunEnlaceRoto(),
    juez({ nombre: "cumple-lo-pedido", foco: "pedidos_y_pagina", criterio: CUMPLE_LO_PEDIDO, puntua: false }),
  ];
}

/** What each break adds. Values nobody gives: a phone, an address and a price that no customer said. */
const BREAKS = {
  "dato-inventado": `<p>Llámanos al 55 1234 0000 · escríbenos a reservas@inventado.example · desde $123,456</p>`,
  // `overflow-x` set back to visible: many pages hide it on the body, and then nothing would overflow.
  "desborde-movil": `<style>html,body{overflow-x:visible!important}</style><div style="width:1600px;height:8px"></div>`,
  "enlace-roto": `<a href="/pagina-que-no-existe">Ver más</a>`,
} as const;

const withBreak = (html: string, extra: string) => (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${extra}</body>`) : `${html}${extra}`);

/** Broken on purpose from the customer's own final page, so each voting grader is seen red at least once
 *  (validar.ts, rule 3) — the battery's «null»: a blank page, then one break per grader family. */
export function customerRotas(f: FetchedCase): Encargo["rotas"] {
  const html = f.final.html ?? "";
  const roto = (nombre: keyof typeof BREAKS): { nombre: string; datos: DatosDelCaso } => ({
    nombre,
    datos: { ...f.final, html: withBreak(html, BREAKS[nombre]) },
  });
  return [{ nombre: "pagina-en-blanco", datos: { html: "" } }, roto("dato-inventado"), roto("desborde-movil"), roto("enlace-roto")];
}
