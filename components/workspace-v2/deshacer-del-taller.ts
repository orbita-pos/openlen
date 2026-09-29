// DESHACER EN EL TALLER — la decisión, fuera del componente para poder probarla.
//
// Es `/rewind` de Claude Code: se restaura una copia que hizo el SERVIDOR antes
// de aplicar el cambio, nunca un documento que mande el navegador. Hasta el
// 2026-09-29 el Deshacer del taller mandaba la página entera por `PATCH /html`,
// que tenía que sanearla, y cada Deshacer le quitaba todos sus `onclick`.
//
// El punto de deshacer es un LOTE de ediciones (las que caen juntas antes de
// «Aplicar»). Tres casos, y ninguno opinable:
//   1. El lote aún no salió: el servidor no lo ha visto. Deshacer es tirarlo y
//      volver a lo guardado.
//   2. Salió y el servidor contestó con su copia de antes: se restaura ésa.
//   3. Salió y no hay copia (el guardado falló, o la copia no se pudo
//      escribir): no hay Deshacer, y se dice. Ofrecer uno que manda el
//      documento sería volver al fallo.

export type PlanDeDeshacer =
  | { readonly kind: "descartar" }
  | { readonly kind: "restaurar"; readonly versionId: string; readonly page: string | null }
  | { readonly kind: "sin-copia" };

export function planDeDeshacerDelTaller(
  punto: { readonly page: string | null; readonly lote: number },
  /** El lote que se está llenando ahora. */
  loteActual: number,
  /** Lote enviado → id de la copia de antes que devolvió el servidor. */
  copias: ReadonlyMap<number, string | null>,
): PlanDeDeshacer {
  if (punto.lote === loteActual) return { kind: "descartar" };
  const versionId = copias.get(punto.lote) ?? null;
  return versionId ? { kind: "restaurar", versionId, page: punto.page } : { kind: "sin-copia" };
}
