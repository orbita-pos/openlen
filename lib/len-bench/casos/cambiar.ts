// lib/len-bench/casos/cambiar.ts — las ediciones a mano con las que se escribe
// la SOLUCIÓN de un caso y cada ROTA.
//
// `String.replace` no avisa si no encuentra su texto: la rota sale idéntica a
// la solución y el síntoma es un confuso «X nunca se vio en rojo». Y si el
// texto está dos veces, cambia el primero sin decir cuál. Aquí las dos cosas
// son un error con nombre, al cargar el caso.

/** `[buscar, poner]` cambia la ÚNICA aparición; `[buscar, poner, n]` cambia
 *  las n, y exige que sean exactamente n. */
export type Cambio = readonly [buscar: string, poner: string, veces?: number];

export function cambiar(html: string, cambios: readonly Cambio[]): string {
  let out = html;
  for (const [buscar, poner, esperadas] of cambios) {
    const partes = out.split(buscar);
    const veces = partes.length - 1;
    const corto = buscar.slice(0, 120);
    if (veces === 0) throw new Error(`no encontré «${corto}» en la página`);
    if (esperadas !== undefined) {
      if (veces !== esperadas) throw new Error(`«${corto}» está ${veces} veces y se esperaban ${esperadas}`);
      out = partes.join(poner);
      continue;
    }
    if (veces > 1) throw new Error(`«${corto}» está ${veces} veces: no se sabe cuál cambiar`);
    out = out.replace(buscar, () => poner);
  }
  return out;
}
