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
