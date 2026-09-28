// lib/agent/esfuerzo.ts — LA POSTURA del Agente: lo que el usuario elige.
//
// 🔴 TRES CAPAS, Y ÉSTA ES LA DE ARRIBA. `FireworksReasoningEffort` hacía los
// tres trabajos a la vez —vocabulario, política y cable— y por eso el mando
// anterior se rompía: `none` no es un nivel bajo, es APAGAR la función, y vive
// en otra capa. Claude Code las tiene separadas y por eso su
// selector funciona.

/** LOS NIVELES, ordenados. Es la escalera de Claude Code, en el mismo orden.
 *
 *  `auto` NO está aquí a propósito, igual que allí: en el texto de ayuda de
 *  Claude Code se añade aparte y AL FINAL
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
 * En Claude Code `auto` NO significa «no mandes nada»: significa «elijo yo por
 * ti». Resuelve por tabla —al defecto del modelo, o `high` si no lo tiene— y
 * la UI lo ENSEÑA resuelto: `Effort level: auto (currently high)`. El invariante que sostiene todo eso es
 * que el usuario nunca ignore en qué nivel está corriendo.
 *
 * El nivel se resuelve y se enseña; lo que se omite es el PRESUPUESTO del nivel
 * por defecto (H5, ver `PRESUPUESTO`), que son dos ejes distintos. Sin campo el
 * modelo piensa lo que decide: mediana 239, rango 196..691 (11/09).
 *
 * `high` es la posición 3 de 5, igual que el defecto de Claude Code, o sea con dos
 * niveles POR ENCIMA. */
export const NIVEL_POR_DEFECTO: NivelEsfuerzo = "high";

/** `auto` al nivel concreto que le toca; cualquier otro, a sí mismo. Como en
 *  Claude Code, lo usan por igual el cable (para saber qué mandar) y
 *  la UI (para poder decir «Automático (ahora: …)»). Una sola fuente para las
 *  dos, porque el día que discrepen la etiqueta miente. */
export function resolverEsfuerzo(nivel: EsfuerzoAgente): NivelEsfuerzo {
  return nivel === "auto" ? NIVEL_POR_DEFECTO : nivel;
}

/** LOS PRESUPUESTOS. `"adaptativo"` es no mandar ninguno: el modelo decide.
 *
 * 🔴 H5 (2026-09-26): EL DEFECTO YA NO ATA. Con `high` = 100, en los 1.473
 * pasos del control de Len-Bench el razonamiento dio p50 100 y máximo 113 —el
 * tope ataba SIEMPRE—, y en 17 peticiones el modelo siguió razonando en inglés
 * dentro del texto que lee el dueño (una vez hasta los 32.768 tokens de
 * salida). Claude Code manda `{type:"adaptive"}` en TODOS los
 * niveles cuando el modelo sabe pensar solo, y el nivel viaja por otro eje;
 * sin «adaptive», su presupuesto es el techo de salida menos uno, con suelo de
 * 1024. Nunca convierte un nivel en un tope pequeño. Lo decidió Jesús: el
 * modelo decide cuánto pensar. La razón del 11/09 para fijar 100 era la
 * previsibilidad del dial, no la calidad.
 *
 * El dial, medido el 2026-09-11 (sonda `scripts/medir-dial-esfuerzo.ts`, 72
 * llamadas contra `deepseek-v4p1-flash`): ata EXACTO hasta 225 (desvío +0) y
 * desde 250 deja de atar y cae en la banda del modelo (210–330). Sin campo:
 * mediana 239, rango 196–691. Por eso:
 *
 *   - `low` y `medium` siguen siendo números: son los únicos niveles donde el
 *     dial hace lo que dice, pensar MENOS;
 *   - `xhigh` es 1024, el suelo que Claude Code pone a todo presupuesto, y
 *     `max` el techo de salida menos uno, su presupuesto por defecto. Los dos
 *     quedan por encima de la banda del modelo: son TECHOS, no órdenes, y no
 *     está medido que piensen más que `high`.
 *
 *  ⚠️ Y con `high` adaptativo, en DeepSeek NO pueden pensar más: por eso V4.1
 *  Flash ya no los ofrece (su tope en `DIAL_MEDIDO` es `high`). Se quedan en el
 *  vocabulario para el modelo en el que alguien mida que sí suben. */
const PRESUPUESTO: Readonly<Record<NivelEsfuerzo, number | "adaptativo">> = {
  low: 25,
  medium: 60,
  high: "adaptativo",
  xhigh: 1024,
  max: Number.POSITIVE_INFINITY,
};

/**
 * El número que viaja al cable, o `undefined` para no mandar ninguno —el
 * `{type:"adaptive"}` de Claude Code: el modelo decide—.
 *
 * `auto` resuelve a `high` como siempre (la UI dice «Automático (ahora:
 * high)»), y `high` es el adaptativo. El recorte contra el techo de salida es
 * el de Claude Code (`Math.min(max_tokens - 1, …)`): pedir más pensamiento del
 * que cabe en la salida es pedir un turno truncado. Su suelo de 1024 no se
 * aplica a `low` y `medium`, que en este dial son números pequeños a propósito.
 */
export function presupuestoDeEsfuerzo(
  nivel: EsfuerzoAgente,
  techoSalida: number,
): number | undefined {
  const p = PRESUPUESTO[resolverEsfuerzo(nivel)];
  if (p === "adaptativo") return undefined;
  return Math.max(1, Math.min(p, techoSalida - 1));
}

// ─── LO QUE EL DIAL HACE EN CADA MODELO ─────────────────────────────────────
//
// LA FORMA ES DE CLAUDE CODE: LA CAPACIDAD SE DECLARA POR MODELO. Cada entrada
// de su catálogo dice qué niveles admite ese modelo y a cuál resuelve por
// defecto. Eso —que la escalera la diga el MODELO y no una constante— es lo que
// se copió, y es lo correcto.
//
// ⚰️ AQUÍ DECÍA que su reserva para un modelo que no conoce es
// `["low","medium","high"]` y que «`xhigh` y `max` se GANAN». **ES FALSO**
// (comprobado el 2026-09-13):
//
//   · Esa reserva sólo aplica cuando el valor no resuelve a NINGÚN modelo, y
//     entonces el esfuerzo ni siquiera se admite — la UI pinta «Effort not
//     supported» y esos tres niveles no se pintan jamás. Es un valor por
//     defecto muerto, no una política.
//   · Para un modelo REAL que su catálogo no conoce, si el proveedor es
//     Anthropic se admite, y la escalera sólo se recorta por el tope de la
//     ORGANIZACIÓN. **Su reserva es PERMISIVA: los cinco.**
//   · Lo restrictivo allí es otra cosa: una lista negra de modelos viejos, un
//     proveedor ajeno, o que el catálogo lo diga explícitamente.
//
// 🔴 LA REGLA DE ABAJO NO CAMBIA, y conviene saber que es NUESTRA. Nosotros
// ofrecíamos los cinco a cualquier cosa con un dial medido sobre UN
// modelo, y el papel del Agente ha cambiado de modelo dos veces en tres semanas:
// el día que cambie a uno sin medir, `max` sería una etiqueta que promete un
// dial que nadie ha comprobado que exista. Así que aquí la capacidad se gana
// MIDIENDO — un modelo entra en esta tabla cuando alguien le ha pasado
// `scripts/medir-dial-esfuerzo.ts`. Es MÁS ESTRICTO que Claude Code a propósito:
// él tiene un catálogo publicado detrás de cada modelo y nosotros tenemos una
// sonda. Lo que se copia de él es dónde vive la decisión, no su valor por
// defecto.

/** El tope de dial COMPROBADO de cada modelo, por `modelId`.
 *
 *  `deepseek-v4p1-flash`: sonda de 72 llamadas el 2026-09-11 ($0.0174). Devuelve
 *  exactamente lo que se le pide hasta 225 (desvío +0, rango 13-24); de 250 para
 *  arriba el desvío falla y cae en su propia banda. Está medido que el campo se
 *  acepta en toda la escalera (72 de 72 en HTTP 200, también con 2000).
 *
 *  🔴 SU TOPE ES `high`, NO `max` (2026-09-26, con OK de Jesús). En DeepSeek el
 *  campo es un TECHO de pensamiento: puede hacerle pensar menos, nunca más. Con
 *  H5, `high` no manda techo —el modelo decide—, y en la rama de E eso dio p90
 *  1.299 y máximo 22.071 tokens por paso. `xhigh` (techo 1.024) pensaba entonces
 *  MENOS que `high` en uno de cada diez pasos, y `max` (sin techo útil) era
 *  `high` con otro nombre. Ofrecerlos era prometer «más» con un nivel que da
 *  igual o menos. Que el campo se ACEPTE no es que el nivel HAGA algo: lo único
 *  medido que hace el dial en este modelo es pensar menos (`low`, `medium`). */
const DIAL_MEDIDO: Readonly<
  Record<string, { readonly defecto: NivelEsfuerzo; readonly tope: NivelEsfuerzo }>
> = {
  "accounts/fireworks/models/deepseek-v4p1-flash": { defecto: "high", tope: "high" },
};

/** NUESTRA reserva para un modelo sin sonda: los tres de en medio, con el
 *  defecto (`high`) arriba del todo. No es la de Claude Code —la suya es
 *  permisiva, ver el bloque de arriba—: es más estricta a propósito, porque lo
 *  que aquí declara la capacidad es una medición y no un catálogo publicado. */
const NIVELES_SIN_MEDIR: readonly NivelEsfuerzo[] = ["low", "medium", "high"];

export interface CapacidadDeEsfuerzo {
  /** Los niveles que este modelo puede OFRECER. Lo pinta el mando. */
  readonly niveles: readonly NivelEsfuerzo[];
  /** A qué resuelve `auto` en este modelo. Es el nivel por defecto de Claude
   *  Code, con su misma reserva: `high`. */
  readonly defecto: NivelEsfuerzo;
  /** ¿Está medido este modelo, o corre con la reserva? Se expone para que quien
   *  lo pinte pueda decirlo en vez de que el usuario deduzca de una lista corta
   *  que su modelo es peor. */
  readonly medido: boolean;
}

/** Qué dial tiene ESTE modelo. Como en Claude Code: lo dice el modelo. */
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
 * seguiría mandando el día que el papel cambie a uno sin medir — un número a un
 * dial que nadie ha comprobado, y sin que el mando siquiera enseñe esa opción.
 * Claude Code hace exactamente este recorte al elegir modelo: el nivel se
 * acota a los que ese modelo admite.
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
