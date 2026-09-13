/**
 * LAS TARIFAS CON LAS QUE UNA CORRIDA PAGADA SE FRENA A SÍ MISMA.
 *
 * Vivían dentro de `scripts/agent-eval.ts`. Se sacan aquí el 2026-09-04 porque
 * un segundo runner (`scripts/sobre-ab.ts`) las necesita, y la alternativa era
 * copiarlas — que es exactamente el defecto que ya mordió a este fichero:
 * estuvieron CABLEADAS y desfasadas (0.14/0.28 contra 0.22/0.66) y sin entrada
 * para Pro, así que el Agente se cobraba como si fuera Gemini y el tope de
 * gasto mentía. Una tarifa duplicada es una tarifa que se queda vieja en un
 * sitio y no en el otro.
 *
 * 🔴 SALEN DE `lib/credits.ts`, que es donde se cobra de verdad. Aquí no se
 * escribe NINGÚN número a mano.
 *
 * ⚰️ Esta línea decía «salvo el de visión, que no pasa por ahí». Caducó sin
 * avisar: `qwen-vision` entró en `lib/credits.ts` el 2026-08-28 y la excepción
 * se quedó escrita, sujetando el último número cableado del fichero — la tarifa
 * de un proveedor que ya no corre. Medido el 2026-09-07.
 *
 * 🔴 Y LAS CLAVES SALEN DE `MODEL_POLICY`, no de literales. Con el id del
 * modelo escrito a mano aquí, cambiarlo en la política dejaba esta fila
 * huérfana y el turno caía al respaldo sin que nadie lo notara: la tabla que
 * mide el gasto tiene que moverse con la que decide quién lo gasta.
 */
import { creditRate, type CreditRate } from "@/lib/credits";
import { MODEL_POLICY } from "@/lib/generation/model-policy";

export interface TarifaPorMillon {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

const deCreditos = (k: CreditRate): TarifaPorMillon => {
  const r = creditRate(k);
  return { input: r.input, cached: r.cached ?? 0, output: r.output };
};

// 🔴 Y LA TARIFA TAMBIÉN SALE DEL PAPEL, desde el 2026-09-11. La clave ya venía
// de `MODEL_POLICY` —por eso no hubo fila huérfana— pero el VALOR seguía escrito
// a mano, así que cambiar el modelo del papel `agent` dejaba esta fila
// tarificando el modelo nuevo al precio del viejo. Medido: 6x inflado, y la
// cabecera de este fichero ya contaba dos versiones anteriores del mismo
// defecto. Una clave que se mueve sola y un valor que no es media extracción.
//
// Los OJOS entran por el papel `visualCritic`; hasta el 2026-09-07 este arnés
// los cobraba a `gemini-2.5-flash` (0,30/2,50) contra los reales — entrada un
// 25% corta, salida un 56% larga, y `usdTotal` alimenta `--max-mxn`.
//
// ⚠️ SE RECORRE EN VEZ DE ESCRIBIRSE, y la razón es de compilador: desde el
// 2026-09-12 DOS papeles comparten modelo (`agent` y `visualCritic`, los dos en
// `deepseek-v4p1-flash`), y un literal con la misma clave dos veces no compila.
// Recorrer además hace que un papel NUEVO entre en la tabla solo, que es lo que
// esta tabla lleva tres versiones intentando.
const RATES_PER_M: Readonly<Record<string, TarifaPorMillon>> = Object.freeze(
  Object.fromEntries(
    Object.values(MODEL_POLICY).map((papel) => [papel.modelId, deCreditos(papel.creditRate)]),
  ),
);

/** Los modelos que esta tabla sabe tarifar. Se exporta para que la prueba pueda
 *  comprobar PROPIEDADES sobre la tabla entera en vez de la identidad de una
 *  constante — que es como el respaldo de abajo llegó a ser el más barato. */
export const MODELOS_TARIFADOS: readonly string[] = Object.keys(RATES_PER_M);

/** El techo de la tabla, eje por eje. Se CALCULA, no se elige: nombrar un
 *  modelo aquí es lo que dejó el respaldo apuntando a Gemini —el más barato— con
 *  el comentario de abajo diciendo lo contrario y una prueba verde encima. */
const LA_MAS_CARA: TarifaPorMillon = Object.values(RATES_PER_M).reduce(
  (peor, r) => ({
    input: Math.max(peor.input, r.input),
    cached: Math.max(peor.cached, r.cached),
    output: Math.max(peor.output, r.output),
  }),
  { input: 0, cached: 0, output: 0 },
);

/** La tarifa de los ojos: la del modelo que de verdad mira, según la política.
 *  No una constante congelada con nombre de proveedor — ésa es la que mintió. */
export const VISION_RATE: TarifaPorMillon = RATES_PER_M[MODEL_POLICY.visualCritic.modelId];

/** Un modelo desconocido se cobra al MÁS CARO que conocemos: equivocarse hacia
 *  arriba detiene la batería antes de tiempo; hacia abajo, vacía la cuenta. */
export function rateFor(modelId: string): TarifaPorMillon {
  return RATES_PER_M[modelId] ?? LA_MAS_CARA;
}

/** Lo que cuesta un turno, en dólares, a partir de sus tokens medidos. */
export function usdDeTurno(
  tokens: { entrada: number; cacheada: number; salida: number },
  tarifa: TarifaPorMillon,
): number {
  return (
    ((tokens.entrada - tokens.cacheada) * tarifa.input +
      tokens.cacheada * tarifa.cached +
      tokens.salida * tarifa.output) / 1e6
  );
}

/**
 * Lo que costaron VARIOS turnos. Existe como función y no como un `reduce` en
 * cada runner por un motivo medido: el 2026-09-04 un `reduce` de
 * `scripts/sobre-ab.ts` perdió su acumulador y durante una corrida entera
 * imprimió el coste del ÚLTIMO turno como si fuera el total — $0,0091 en vez de
 * $0,3415, o sea 37x MENOS. Y ése es el lado peligroso: un total que se queda
 * corto no detiene una corrida, la deja seguir.
 *
 * La suma de una lista de precios no es lógica que cada llamador deba reescribir.
 */
export function usdTotal(
  turnos: readonly { entrada: number; cacheada: number; salida: number }[],
  tarifa: TarifaPorMillon,
): number {
  let usd = 0;
  for (const t of turnos) usd += usdDeTurno(t, tarifa);
  return usd;
}
