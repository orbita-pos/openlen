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

/** The judge's one criterion, fixed text: nobody's data in it. It starts without voting (`puntua: false`) until it
 *  agrees with ~15 labels Jesús puts by hand (spec §9 row 7). */
export const CUMPLE_LO_PEDIDO =
  "Cada cosa concreta que el dueño pidió en sus mensajes numerados está hecha en la página final. " +
  "Lo que pidió y después cambió cuenta en su última versión. Si falta una sola cosa pedida, FAIL.";

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
