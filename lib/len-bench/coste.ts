// lib/len-bench/coste.ts — lo que costó de verdad un encargo.
//
// La ruta ya sabe grabar cada turno del papel `agent` (lib/agent/grabacion.ts,
// `OPENLEN_AGENT_RECORD_DIR`), con un evento `usage` por llamada al modelo. La
// grabadora existe desde el 2026-09-01, así que está también en Len 1.5 y la
// misma cuenta sirve para las dos versiones. El fichero lleva el `requestId`
// del turno, que en la ruta es el `projectId`.
//
// Los precios salen de lib/ai/tarifas-eval.ts, lo mismo que usan los demás
// corredores de pago: aquí no se escribe una sola cifra.
//
// ⚠️ Lo que NO está aquí: las llamadas de los ojos (visión) y las del juez del
// objetivo no pasan por la grabadora. Por eso el tope de gasto del corredor
// multiplica esta cifra por un margen, en vez de fiarse de ella a secas.
//
// La revisión de H14 SÍ está: la grabación guarda su uso (`revision.uso`), y
// corre en el mismo modelo que el turno. Tiene que contar: lo que mata la
// hipótesis es que cueste más de +$0,02 por encargo, y sin esto su brazo se
// mediría gratis.

import fs from "node:fs";
import path from "node:path";
import { MODELOS_TARIFADOS, rateFor, usdDeTurno, type TarifaPorMillon } from "@/lib/ai/tarifas-eval";
import type { TurnoGrabado } from "@/lib/agent/grabacion";

/**
 * La tarifa del modelo que grabó el turno, o un error que lo dice.
 *
 * `rateFor` cobra un modelo desconocido al MÁS CARO, y para un TOPE de gasto
 * es lo correcto: equivocarse hacia arriba frena antes. Pero esto es el
 * INFORME, que no puede mentir hacia ningún lado. En la fase 1 correrán modelos
 * que la política no conoce: sin su fila, el coste tiene que fallar ruidoso.
 */
export function tarifaDelModelo(modelId: string): TarifaPorMillon {
  if (!MODELOS_TARIFADOS.includes(modelId)) {
    throw new Error(
      `el modelo «${modelId}» grabó un turno y no tiene tarifa en lib/ai/tarifas-eval.ts, que la deriva de ` +
        `MODEL_POLICY: sin ella no se puede decir cuánto costó. Añade su papel y su fila en lib/ai/tarifas.ts.`,
    );
  }
  return rateFor(modelId);
}

export function usdDeGrabacion(g: TurnoGrabado): number {
  const tarifa = tarifaDelModelo(g.meta.modelId ?? "");
  let usd = 0;
  for (const llamada of [...g.turnos, ...(g.cierre ? [g.cierre] : [])]) {
    for (const ev of llamada) {
      if (ev.type === "usage") {
        usd += usdDeTurno({ entrada: ev.inputTokens, cacheada: ev.cachedTokens, salida: ev.outputTokens }, tarifa);
      }
    }
  }
  if (g.revision && "uso" in g.revision) {
    const u = g.revision.uso;
    usd += usdDeTurno({ entrada: u.inputTokens, cacheada: u.cachedTokens, salida: u.outputTokens }, tarifa);
  }
  return usd;
}

export function usdDeProyecto(dir: string, projectId: string): { usd: number; grabaciones: number } {
  if (!fs.existsSync(dir)) return { usd: 0, grabaciones: 0 };
  let usd = 0;
  let grabaciones = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || !f.includes(projectId)) continue;
    usd += usdDeGrabacion(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as TurnoGrabado);
    grabaciones++;
  }
  return { usd, grabaciones };
}
