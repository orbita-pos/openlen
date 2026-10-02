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
// ⚠️ Lo que NO está aquí: las llamadas con visión (`describir`, que Len pide
// cuando quiere) no pasan por la grabadora. Por eso el tope de gasto del
// corredor multiplica esta cifra por un margen, en vez de fiarse de ella a
// secas. (Hasta Len 2.1 también los ojos al cerrar y el juez del objetivo:
// los ojos ya no llaman a la visión y el objetivo se retiró.)

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
  return usd;
}

/** Las grabaciones de los turnos de ESE proyecto. Las usan el coste y los pasos (`pasos.ts`). */
export function grabacionesDeProyecto(dir: string, projectId: string): TurnoGrabado[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f.includes(projectId))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as TurnoGrabado);
}

export function usdDeProyecto(dir: string, projectId: string): { usd: number; grabaciones: number } {
  const gs = grabacionesDeProyecto(dir, projectId);
  return { usd: gs.reduce((s, g) => s + usdDeGrabacion(g), 0), grabaciones: gs.length };
}

/**
 * El coste de un proyecto en cuanto su grabación esté en el disco.
 *
 * La ruta CIERRA el stream antes de escribir la grabación (app/api/agent/
 * route.ts: `close()` en el cuerpo del turno, la grabación en su `finally`).
 * Quien lee el coste justo al acabar un turno lee 0 o un JSON a medio
 * escribir. El conductor no lo nota: lee después de publicar y calificar. El
 * corredor de disparos, con un solo turno, sí. Si la grabación no aparece en
 * el plazo, se cuenta el estimado y se DICE: el tope de gasto se mira sobre
 * esta cifra y no puede quedarse corto en silencio.
 */
export async function esperarUsdDeProyecto(
  dir: string,
  projectId: string,
  o: { plazoMs: number; pausaMs: number } = { plazoMs: 30_000, pausaMs: 500 },
): Promise<{ usd: number; aviso?: string }> {
  const hasta = Date.now() + o.plazoMs;
  for (;;) {
    try {
      const r = usdDeProyecto(dir, projectId);
      if (r.grabaciones > 0) return { usd: r.usd };
    } catch (e) {
      // A medio escribir, se vuelve a mirar. Cualquier otra cosa —un modelo
      // sin tarifa— falla ruidosa, como en el informe.
      if (!(e instanceof SyntaxError)) throw e;
    }
    if (Date.now() > hasta) {
      return {
        usd: USD_POR_TURNO_ESTIMADO,
        aviso: `no apareció la grabación del turno en ${o.plazoMs / 1000} s: se cuenta el estimado ($${USD_POR_TURNO_ESTIMADO})`,
      };
    }
    await new Promise((r) => setTimeout(r, o.pausaMs));
  }
}

// MEDIDO en el humo del 2026-09-23 (taqueria-menu-whatsapp, 1 corrida): $0,0125
// en 3 turnos = $0,0042 por turno, cliente simulado incluido. Pero aquella
// partida era una página de 1 KB, y las de verdad de OpenLen pesan decenas de
// KB: el turno que las lee y las edita paga esos tokens. Se deja en ~2,4× lo
// medido hasta medirlo con partidas reales. Mejor sobrar que drenar la cuenta.
export const USD_POR_TURNO_ESTIMADO = 0.01;
// Las grabaciones sólo cuentan el papel `agent`; los ojos no pasan por ellas
// (el juez sí se suma, aparte: `usdJuez`). El tope se aplica sobre la cifra
// grabada × este margen.
export const MARGEN_NO_GRABADO = 1.5;
export const TOPE_POR_DEFECTO_USD = 0.3;

/**
 * EL ESTIMADO, EN CÉNTIMOS Y HACIA ARRIBA.
 *
 * El corredor comparaba `turnos × 0,01 × 1,5 > tope` en coma flotante, y 20
 * turnos dan 0,30000000000000004: MAYOR que 0,30. Así que el tope que el propio
 * corredor imprimía («~$0.30») se rechazaba y pedía 0,31 (humo de contratos,
 * 2026-09-30). Y al revés con los medios céntimos: 3 turnos dan 0,045, que
 * `toFixed(2)` imprime como 0,04 — el estimado PESIMISTA salía redondeado a la
 * baja. Se cuenta en céntimos enteros, redondeando hacia arriba, con una
 * holgura de 1e-9 para que el ruido de la coma flotante no invente un céntimo.
 */
export function centimosDelEstimado(usd: number): number {
  return Math.ceil(usd * 100 - 1e-9);
}

/** ¿El estimado pasa del tope declarado? En céntimos: el tope lo teclea una
 *  persona con dos decimales, y así es como se compara. */
export function estimadoExcedeTope(estimadoUsd: number, topeUsd: number): boolean {
  return centimosDelEstimado(estimadoUsd) > Math.round(topeUsd * 100);
}
