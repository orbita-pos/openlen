// lib/agent/esfuerzo.ts — LA POSTURA del Agente: lo que el usuario elige.
//
// 🔴 TRES CAPAS, Y ÉSTA ES LA DE ARRIBA. `FireworksReasoningEffort` hacía los
// tres trabajos a la vez —vocabulario, política y cable— y por eso el mando
// anterior se rompía: `none` no es un nivel bajo, es APAGAR la función, y vive
// en otra capa. El binario de Claude Code las tiene separadas y por eso su
// selector funciona.

/** LOS NIVELES, ordenados. Es el `Tm` del binario, literal:
 *  `var Tm = ["low","medium","high","xhigh","max"]`.
 *
 *  `auto` NO está aquí a propósito, igual que allí: en el texto de ayuda del
 *  binario se añade aparte y AL FINAL
 *  (`Usage: /effort [low|medium|high|xhigh|max|ultracode|auto]`), porque no es
 *  un peldaño de la escalera sino la instrucción de elegir peldaño por ti. */
export const NIVELES = ["low", "medium", "high", "xhigh", "max"] as const;

export type NivelEsfuerzo = (typeof NIVELES)[number];
export type EsfuerzoAgente = "auto" | NivelEsfuerzo;

/** El vocabulario COMPLETO, `auto` incluido. Lo consume la capa de precedencia
 *  para validar lo que llega de fuera (entorno y base), donde `auto` sí es un
 *  valor legítimo que alguien puede haber guardado. Para PINTAR la escalera se
 *  usa `NIVELES`, que es la de verdad. */
export const ESFUERZOS: readonly EsfuerzoAgente[] = ["auto", ...NIVELES] as const;

/** A QUÉ NIVEL RESUELVE `auto`, y por qué existe esta constante.
 *
 * En el binario `auto` NO significa «no mandes nada»: significa «elijo yo por
 * ti». Resuelve por tabla —`oe(e){ return el($e(e))?.default_effort ?? "high" }`—
 * y la UI lo ENSEÑA resuelto: `rKe()` imprime literalmente
 * `Effort level: auto (currently high)`. El invariante que sostiene todo eso es
 * que el usuario nunca ignore en qué nivel está corriendo.
 *
 * 🔴 Nuestro `auto` ANTERIOR omitía el campo, y eso rompía ese invariante de la
 * peor manera: MEDIDO el 2026-09-11 con 72 llamadas, omitirlo da una mediana de
 * 237 tokens de razonamiento con un RANGO DE 495 (196..691). O sea que «auto»
 * no era una elección, era una caja negra que además pensaba MÁS que el nivel
 * más alto que le ofrecíamos al usuario. Resolver a un nivel nuestro es lo que
 * lo convierte en una promesa: `high` da 100 con rango 13.
 *
 * `high` es la posición 3 de 5, igual que el defecto del binario, o sea con dos
 * niveles POR ENCIMA — que es lo que hace que subir de nivel signifique algo. */
export const NIVEL_POR_DEFECTO: NivelEsfuerzo = "high";

/** `auto` al nivel concreto que le toca; cualquier otro, a sí mismo. Es el
 *  `fE()` del binario, y lo usan por igual el cable (para saber qué mandar) y
 *  la UI (para poder decir «Automático (ahora: …)»). Una sola fuente para las
 *  dos, porque el día que discrepen la etiqueta miente. */
export function resolverEsfuerzo(nivel: EsfuerzoAgente): NivelEsfuerzo {
  return nivel === "auto" ? NIVEL_POR_DEFECTO : nivel;
}

/** LOS NÚMEROS, y esta vez están MEDIDOS — ya no son provisionales.
 *
 * Sonda `scripts/medir-dial-esfuerzo.ts`, 72 llamadas reales contra
 * `deepseek-v4p1-flash` el 2026-09-11 ($0.0174). Lo que se midió:
 *
 *   - El dial devuelve EXACTAMENTE lo que se le pide, y apretado, hasta 225:
 *     100 da mediana 100 (rango 13), 200 da 200 (rango 22), 225 da 225
 *     (rango 24), los tres con desvío +0.
 *   - Desde 250 deja de atar: el desvío falla (+13, −28, −31) y el rango se
 *     dobla en 250 (55) y se sextuplica en 300 (142). Pedir de 250 para arriba
 *     es pagar impredecibilidad, no pensamiento.
 *   - El proveedor ACEPTA valores > 100 (72 de 72 en HTTP 200, ni uno
 *     rechazado, ni con 2000): la «escala nativa 1-100» no la impone él.
 *
 * Así que la escala útil es **1..225**, y estos cinco caen todos dentro con el
 * defecto (`high`) en el centro. Subirlos por encima de 225 no compra
 * pensamiento; lo comprobado es que compra varianza. */
const PRESUPUESTO: Readonly<Record<NivelEsfuerzo, number>> = {
  low: 25,
  medium: 60,
  high: 100,
  xhigh: 160,
  max: 225,
};

/**
 * El número que viaja al cable. SIEMPRE hay número, también con `auto`.
 *
 * Antes `auto` devolvía `undefined` para omitir el campo, y este comentario
 * defendía esa omisión citando al binario. Estaba mal leído: lo que el binario
 * omite es el PRESUPUESTO DE PENSAMIENTO (`{type:"adaptive"}`), y eso lo decide
 * `c9t()` a partir del MODELO —no del nivel que eligió la persona—. En el eje
 * del NIVEL, que es éste, el binario nunca omite: resuelve y manda.
 *
 * El recorte es del binario: `qf = Math.max(1024, Math.min(aD - 1, qf))`, con
 * una segunda instancia de la misma forma en `Cps`. El suelo no era invención
 * nuestra; su valor es el mínimo legal de cada escala (1024 tokens allí, 1 en
 * un dial que empieza en 1). Con los números de arriba el `Math.min` no muerde
 * en ninguna configuración real —el techo de salida más bajo es
 * `CLOSEOUT_MAX_OUTPUT_TOKENS = 2048` y el nivel más alto pide 225—, pero se
 * queda porque es la regla, no la casualidad: pedir más pensamiento del que
 * cabe en la salida es pedir un turno truncado.
 */
export function presupuestoDeEsfuerzo(
  nivel: EsfuerzoAgente,
  techoSalida: number,
): number {
  return Math.max(1, Math.min(PRESUPUESTO[resolverEsfuerzo(nivel)], techoSalida - 1));
}

// ─── LO QUE EL DIAL HACE EN CADA MODELO ─────────────────────────────────────
//
// 🔴 EL BINARIO NO OFRECE LOS CINCO NIVELES A TODO EL MUNDO, y esto es lo que
// nos faltaba para tener su forma. Su catálogo de modelos lleva, POR MODELO:
//
//   capabilities: ["effort","max_effort","xhigh_effort", …],
//   default_effort: "high",
//   effort_cost_index: { low:0.47, medium:0.74, high:1, xhigh:2.41, max:5.59 }
//
// y `E8(modelId)` devuelve `{supportsMax, supportsXHigh, capLevels,
// defaultEffort}`. Lo decisivo es su RESERVA: cuando no conoce el modelo,
// `capLevels` es `["low","medium","high"]`. **`xhigh` y `max` se GANAN.**
//
// Nosotros ofrecíamos los cinco a cualquier cosa, con un techo de 225 medido
// sobre UN modelo. Y el papel del Agente ha cambiado de modelo dos veces en tres
// semanas: el día que cambie a uno sin medir, `max` sería una etiqueta que
// promete un dial que nadie ha comprobado que exista.
//
// AQUÍ LA CAPACIDAD SE GANA MIDIENDO, que es la forma que le toca a este repo:
// un modelo entra en esta tabla cuando alguien le ha pasado
// `scripts/medir-dial-esfuerzo.ts`. Sin entrada, la reserva del binario.

/** El tope de dial COMPROBADO de cada modelo, por `modelId`.
 *
 *  `deepseek-v4p1-flash`: sonda de 72 llamadas el 2026-09-11 ($0.0174). Devuelve
 *  exactamente lo que se le pide hasta 225 (desvío +0, rango 13-24); de 250 para
 *  arriba el desvío falla y el rango se dobla. Por eso su tope es `max` (225) y
 *  no más — y por eso `max` aquí significa «medido», no «el número más grande
 *  que se nos ocurrió». */
const DIAL_MEDIDO: Readonly<
  Record<string, { readonly defecto: NivelEsfuerzo; readonly tope: NivelEsfuerzo }>
> = {
  "accounts/fireworks/models/deepseek-v4p1-flash": { defecto: "high", tope: "max" },
};

/** La reserva del binario, literal: `capLevels: ["low","medium","high"]`. */
const NIVELES_SIN_MEDIR: readonly NivelEsfuerzo[] = ["low", "medium", "high"];

export interface CapacidadDeEsfuerzo {
  /** Los niveles que este modelo puede OFRECER. Lo pinta el mando. */
  readonly niveles: readonly NivelEsfuerzo[];
  /** A qué resuelve `auto` en este modelo. Es el `default_effort` del binario,
   *  con su misma reserva (`?? "high"`, ver `oe()`). */
  readonly defecto: NivelEsfuerzo;
  /** ¿Está medido este modelo, o corre con la reserva? Se expone para que quien
   *  lo pinte pueda decirlo en vez de que el usuario deduzca de una lista corta
   *  que su modelo es peor. */
  readonly medido: boolean;
}

/** Qué dial tiene ESTE modelo. El `E8(modelId)` del binario. */
export function capacidadDeEsfuerzo(modelId: string): CapacidadDeEsfuerzo {
  const medido = DIAL_MEDIDO[modelId];
  if (!medido) {
    return { niveles: NIVELES_SIN_MEDIR, defecto: NIVEL_POR_DEFECTO, medido: false };
  }
  return {
    niveles: NIVELES.slice(0, NIVELES.indexOf(medido.tope) + 1),
    defecto: medido.defecto,
    medido: true,
  };
}

/**
 * El nivel RECORTADO a lo que el modelo ofrece.
 *
 * 🔴 SIN ESTO LA TABLA NO SIRVE DE NADA. La postura se GUARDA (`users
 * .agentEffort`), así que alguien que eligió `max` con un modelo medido lo
 * seguiría mandando el día que el papel cambie a uno sin medir — 225 a un dial
 * que nadie ha comprobado, y sin que el mando siquiera enseñe esa opción. El
 * binario hace exactamente este recorte (`_7e(…, capLevels, supportsMax,
 * supportsXHigh, supportsUltra)`) al elegir modelo.
 *
 * `auto` NO se recorta: no es un peldaño, es la instrucción de elegir peldaño,
 * y lo que elige ya sale de la capacidad de este modelo.
 */
export function caparEsfuerzo(
  nivel: EsfuerzoAgente,
  capacidad: CapacidadDeEsfuerzo,
): EsfuerzoAgente {
  if (nivel === "auto" || capacidad.niveles.includes(nivel)) return nivel;
  // Al más alto que SÍ ofrece — nunca al más bajo. Quien pidió el techo quiere
  // el techo que haya, no que se le mande al suelo por un cambio de modelo.
  return capacidad.niveles[capacidad.niveles.length - 1] ?? NIVEL_POR_DEFECTO;
}
