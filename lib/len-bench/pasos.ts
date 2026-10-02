// lib/len-bench/pasos.ts — lo que le costó a Len un encargo en PASOS, y las
// llamadas que le fallaron por el camino.
//
// F0 de plans/len-agente-2026 (HOJA-DE-RUTA.md): de la terminal (F1) se espera
// ganancia en pasos y en `Edit` rechazados, no sólo en acierto. El patrón que
// se midió (notas/fase-1-inventario.md §2, encargo `b9ff5b4a`): Grep encuentra
// la dirección en 4 ficheros → 17 Edit en paralelo → los 12 de los ficheros
// vistos sólo por Grep vuelven rechazados → 3 Read → los 12 otra vez. Sin estas
// dos cifras en cada corrida, el README sólo podría decir si acertó.
//
// Los PASOS salen de las grabaciones, como el coste (`coste.ts`): cada llamada
// al modelo es un paso, el cierre por tope incluido. Los FALLOS salen de la
// traza que el conductor rehace con las filas del servidor (`trazaDeLasFilas`):
// la grabación de un turno no guarda lo que devolvieron sus herramientas.

import type { TurnoGrabado } from "@/lib/agent/grabacion";
import type { MensajeDelHistorial } from "@/lib/agent/transcripcion";
import { grabacionesDeProyecto } from "./coste";

export function pasosDeGrabacion(g: Pick<TurnoGrabado, "turnos" | "cierre">): number {
  return g.turnos.length + (g.cierre ? 1 : 0);
}

export function pasosDeProyecto(dir: string, projectId: string): number {
  return grabacionesDeProyecto(dir, projectId).reduce((s, g) => s + pasosDeGrabacion(g), 0);
}

/** Las respuestas de herramienta que volvieron con `ok:false`, contadas por herramienta. */
export function fallidasDeLaTraza(traza: readonly MensajeDelHistorial[]): Record<string, number> {
  const fallidas: Record<string, number> = {};
  for (const m of traza) {
    for (const r of m.functionResponses ?? []) {
      if (r.response.ok === false) fallidas[r.name] = (fallidas[r.name] ?? 0) + 1;
    }
  }
  return fallidas;
}
