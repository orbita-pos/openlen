// lib/len-bench/validar.ts — si un caso es una buena vara, decidido SIN modelo.
//
// Regla 2 (resoluble): con la SOLUCIÓN escrita a mano, todos los graders que
// votan pasan. Si no, el caso es injusto o el grader está roto.
// Regla 3 (discrimina): entre la página de PARTIDA y las ROTAS plantadas, cada
// grader que vota suspende al menos una vez. Si no, no mide nada (memoria
// `el-arma-que-no-discrimina`).
// Regla 4 (lo que no se pidió tocar): ver `faltaLoQueSigue`.
// Y antes de las tres: una rota idéntica a la solución es un `.replace()` que no
// encontró su texto. No avisa solo, y su síntoma sería el confuso «X nunca se
// vio en rojo».
//
// Puro: lo que cuesta (publicar, servir, abrir Chromium) lo hace el script.

import type { Encargo, Intercambio, ResultadoDeGrader, TurnoDeValidacion } from "./tipos";

export function revisarCaso(
  e: Pick<Encargo, "graders" | "solucion" | "rotas">,
  r: {
    readonly solucion: readonly ResultadoDeGrader[];
    /** La partida y cada rota, con lo que sacó cada grader. */
    readonly variantes: readonly { readonly nombre: string; readonly graders: readonly ResultadoDeGrader[] }[];
  },
): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];
  for (const rota of e.rotas) {
    if (JSON.stringify(rota.datos) === JSON.stringify(e.solucion)) {
      problemas.push(`la rota «${rota.nombre}» es IDÉNTICA a la solución: su cambio no encontró el texto que buscaba`);
    }
  }
  for (const g of r.solucion) {
    if (g.puntua && !g.paso) problemas.push(`regla 2 — la SOLUCIÓN suspende ${g.nombre}: ${g.explicacion}`);
  }
  const suspendio = new Set(r.variantes.flatMap((v) => v.graders.filter((g) => g.puntua && !g.paso).map((g) => g.nombre)));
  for (const g of e.graders) {
    if (g.puntua !== false && !suspendio.has(g.nombre)) {
      problemas.push(`regla 3 — ${g.nombre} nunca se vio en rojo (ni en la partida ni en las rotas)`);
    }
  }
  if (faltaLoQueSigue(e)) {
    problemas.push("regla 4 — no declara lo que NO se pidió tocar: ningún grader «sigue-…» que vote (el que no vota no cuenta)");
  }
  return { ok: problemas.length === 0, problemas };
}

/**
 * Regla 4: el caso declara lo que NO se pidió tocar, con un grader `sigue-…`
 * que vota, y la regla 3 le exige una rota que lo suspenda (la de costumbre,
 * `quito-de-mas`). Claude Code no tiene esta regla: el autor de
 * cada caso escribe sus `regex`. Es nuestra, porque en la recalibración del
 * 2026-09-24 Len quitó lo que nadie le pidió (las zapatillas de
 * `encargo-grande`, 3 de 3) y sólo lo cazó que la vuelta preguntaba por ellas.
 */
export function faltaLoQueSigue(e: Pick<Encargo, "graders">): boolean {
  // «sigue» o «siguen» como palabra del nombre: `nombre-nuevo` ya tenía su
  // `la-sastreria-sigue` antes de la regla.
  return !e.graders.some((g) => /(^|-)siguen?(-|$)/.test(g.nombre) && g.puntua !== false);
}

/**
 * ¿Esta variante cuenta como publicada POR LEN al validar? En la corrida lo
 * dice el subdominio del proyecto; al validar no hay Len que publique, y sin
 * esto `len-publico` suspendía la solución de todo caso «…y publícalo». La
 * partida no está publicada (ahí se ve en rojo); la solución y las rotas sí,
 * para que cada rota aísle SU defecto.
 */
export function publicadaAlValidar(e: Pick<Encargo, "publicaLen">, variante: string): boolean {
  return e.publicaLen === true && variante !== "inicio";
}

/**
 * Lo que el dueño ya dijo cuando se califica: los mensajes de su guion. En la
 * corrida la conversación es la real; al validar no hay Len, y con `[]` lo
 * que el dueño dicta en el mensaje (existencias, una fecha) salía como cifra
 * INVENTADA en la solución (`sin-cifras-inventadas`, 23/09). Las respuestas
 * del cliente simulado no están: salen de la ficha, que ya cuenta como dada.
 *
 * Con `turno` (casos de resultados, plans/len-resultados/), detrás de cada
 * mensaje del dueño va lo que diría Len en esa variante: esos casos se
 * califican por lo que Len DIJO, no por la página.
 */
export function conversacionAlValidar(e: Pick<Encargo, "guion">, turno?: TurnoDeValidacion): Intercambio[] {
  return e.guion.flatMap((p, i): Intercambio[] => {
    const dueno: Intercambio = { quien: "dueno", texto: p.mensaje };
    const len = turno?.len[i];
    return len === undefined ? [dueno] : [dueno, { quien: "len", texto: len }];
  });
}
