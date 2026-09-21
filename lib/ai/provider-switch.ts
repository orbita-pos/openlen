/**
 * Quien escribe ESTE turno.
 *
 * Aqui vivia un conmutador de proveedor con TRES interruptores
 * —`OPENLEN_GENERATE_PROVIDER`, `OPENLEN_CHAT_PROVIDER`,
 * `OPENLEN_AGENT_PROVIDER`— y una sola regla: opt-out, la ausencia significa
 * DeepSeek y solo el literal `gemini` volvia atras. El 2026-08-28 salio Gemini
 * del repo y los tres se quedaron sin destino al que volver.
 *
 * NO se conservan apagados. Un interruptor que solo apunta a si mismo se lee
 * como una alternativa que existe, y quien lo encuentre en produccion va a
 * creer que puede tirar de el.
 *
 * Lo que SI queda es la unica pregunta que todavia tiene dos respuestas: al
 * razonador nunca se le manda una imagen, asi que un turno con pixeles lo lleva
 * el papel con vision. Los dos viajan por Fireworks.
 */

import type { ModelRole } from "./fireworks-contracts";

/**
 * Quién escribe DE VERDAD este turno.
 *
 * 🔴 NOMBRA EL PAPEL, NUNCA EL PROVEEDOR, y es una corrección medida el
 * 2026-09-12, no una preferencia de estilo. Estos dos literales decían
 * `"deepseek" | "qwen"`, y ese día el papel con visión dejó de ser Qwen —pasó a
 * `deepseek-v4p1-flash`, porque el anterior llevaba quince días devolviendo 404
 * sin que nada se pusiera rojo—. Con los nombres viejos el tipo habría quedado
 * afirmando que un turno con imagen lo escribe Qwen: falso, y falso EN EL
 * COMPILADOR, que es donde más se cree.
 *
 * Los nombres de proveedor caducan en silencio ([[reglas-de-prompt-que-nombran-la-interfaz]]).
 * El papel no: mientras haya un turno con píxeles habrá alguien con ojos que lo
 * escriba, se llame como se llame. Quién es hoy lo dice `MODEL_POLICY`, que es
 * el único sitio donde debe estar escrito.
 *
 * Y son los MISMOS literales que `ModelRole` en vez de un vocabulario paralelo:
 * quien escribe un turno es un papel de la política, no una tercera cosa. Con
 * dos juegos de nombres hacía falta traducir entre ellos en cada sitio que
 * pregunta la tarifa, y esa traducción escrita a mano es de donde salieron las
 * dos tarifas cableadas que este mismo cambio retira.
 */
export type TurnWriter = Extract<ModelRole, "reasoner" | "visual_critic">;

/**
 * LO QUE EL USUARIO PUEDE FIJAR, y por qué es una lista y no `TurnWriter`.
 *
 * `TurnWriter` es un TIPO: quién puede escribir. Esto es el VOCABULARIO que
 * cruza la frontera — lo que pinta el selector de Crear y lo que valida la ruta
 * cuando llega del navegador. Claude Code hace la misma
 * separación: su selector de modelo valida contra la lista de filas (`…`)
 * y no contra "lo que sea un modelo".
 *
 * Fijar un PAPEL y no un id de modelo es lo que mantiene en pie la regla de la
 * casa «el modelo y su tarifa viajan juntos»: el papel ya lleva `creditRate` en
 * `MODEL_POLICY`, así que no hay forma de elegir un modelo y cobrarlo a otro
 * precio. Y significa que al servidor nunca le llega un id de modelo escrito
 * por el cliente.
 */
export const ESCRITORES_ELEGIBLES: readonly TurnWriter[] = ["reasoner", "visual_critic"];

/** `null` = la fila «Automático»: que decida la imagen, como siempre. */
export type EscritorFijado = TurnWriter | null;

/** Por qué una opción no se puede usar en ESTE turno. Es un código, no una
 *  frase: el texto vive en `messages/*` y lo pone quien pinta. La forma es la
 *  de Claude Code, cuyas filas deshabilitadas llevan el motivo dentro. */
export type MotivoNoDisponible = "sin_vision";

/**
 * ¿Puede este papel escribir ESTE turno? `null` = sí.
 *
 * La única regla que existe es la de siempre: al razonador no se le manda una
 * imagen. Vive aquí y no en el componente para que el selector y el cable no
 * puedan discrepar — el día que discrepen, el selector ofrece algo que la ruta
 * rechaza.
 */
export function motivoNoDisponible(
  escritor: TurnWriter,
  hasImages: boolean,
): MotivoNoDisponible | null {
  return hasImages && escritor === "reasoner" ? "sin_vision" : null;
}

/**
 * Quién escribe DE VERDAD este turno.
 *
 * Con imagen adjunta escribe el papel con visión; sin ella, el razonador.
 * Sigue siendo una función y no un `if` suelto porque cuatro superficies
 * preguntan lo mismo y la respuesta tiene que ser una.
 *
 * 🔴 `fijado` NO PUEDE SALTARSE LA REGLA DE LA VISIÓN, y ése es todo el diseño
 * de este parámetro. Es el mismo recorte silencioso que hace Claude Code cuando
 * lo elegido no cabe en lo que el modelo admite (`…`, y su
 * gemelo nuestro `caparEsfuerzo`): se respeta lo que se pueda respetar y el
 * resto se ajusta, en vez de fallar el turno. Quien fije el razonador y luego
 * adjunte una foto obtiene una página que MIRA la foto, no un error — y el
 * selector ya se lo había dicho, porque esa fila sale deshabilitada con el
 * motivo dentro en cuanto hay una imagen.
 */
export function writerForTurn(
  hasImages: boolean,
  fijado?: EscritorFijado,
  /** A quién cae un turno SIN imagen y sin nada fijado. Es un parámetro y no una
   *  constante porque **ya no hay una sola respuesta**: Crear y el Chat tienen
   *  defectos distintos desde el 2026-09-14. Ver `escritorDeCrear`. */
  porDefectoSinImagen: TurnWriter = "reasoner",
): TurnWriter {
  if (fijado && !motivoNoDisponible(fijado, hasImages)) return fijado;
  return hasImages ? "visual_critic" : porDefectoSinImagen;
}

/**
 * EL DEFECTO DE CREAR, cambiado el 2026-09-14 POR LO QUE SE VIO, no por lo que
 * se midió — y la distinción es el motivo de que esta constante exista.
 *
 * Se pusieron los MISMOS seis briefs sin imagen delante de los dos escritores
 * (`npm run evals:pages -- --escritor=…`). En defectos: **empate, 6/6 limpias
 * las doce**. El cohorte mide defectos, no belleza, así que por ahí no se
 * separaban. Jesús miró las doce a ciegas y prefirió las de V4.1.
 *
 * LO QUE CUESTA, medido en esa misma corrida y dicho antes de decidir: por
 * página, 0,142 → 0,192 MXN (+35%) y 62 → 115 s (**1,8x de espera**). El dinero
 * da igual a esta escala; la espera no, y aun así la belleza es el norte del
 * producto. La decisión fue suya con los dos números delante.
 *
 * ⚠️ PERO EL NÚMERO DEL DINERO ESTABA CORTO, y se deja escrito porque la
 * decisión no se re-abre por esto. Aquel +35% se calculó con las DOS tarifas
 * iguales —`deepseek-v4p1-flash` estaba tarificado al precio de V4 Flash—, así
 * que mide sólo el VOLUMEN de tokens que V4.1 emite de más. Con la tarifa real
 * (0.30/0.006/1.20 contra 0.22/0.007/0.66, salida 1,82x) el coste por página
 * sube bastante más que ese 35%. Corregido el 2026-09-20. Lo que NO cambia es
 * el otro eje —los 1,8x de espera son tiempo, no dinero— ni la razón por la que
 * se eligió, que fue mirar las doce páginas.
 *
 * ⚠️ Una muestra por brief. En dos corridas de V4 Flash sobre los mismos briefs
 * los recortes fueron 0 y luego 3 sin cambiar una línea, así que una diferencia
 * en UNA página sería varianza; lo que pesó fue la preferencia en las seis.
 */
export const ESCRITOR_POR_DEFECTO_DE_CREAR: TurnWriter = "visual_critic";

/**
 * Quién escribe un turno de CREAR.
 *
 * 🔴 EXISTE PARA NO ARRASTRAR AL CHAT. `writerForTurn` lo llaman cuatro sitios,
 * y uno es `ai-design` —el Chat—, cuyo trabajo es EDITAR una página que ya
 * existe, no escribirla de cero. Eso no se comparó, así que cambiar el defecto a
 * secas habría movido una superficie sobre la que no hay ni una medida ni una
 * mirada. Crear cambia; el Chat se queda donde estaba.
 */
export function escritorDeCrear(hasImages: boolean, fijado?: EscritorFijado): TurnWriter {
  return writerForTurn(hasImages, fijado, ESCRITOR_POR_DEFECTO_DE_CREAR);
}
