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
 * ⚰️ AQUÍ VIVÍA LO QUE EL USUARIO PODÍA FIJAR en Crear: `ESCRITORES_ELEGIBLES`,
 * `EscritorFijado`, `motivoNoDisponible` (la fila del razonador apagada con
 * imagen), `ESCRITOR_POR_DEFECTO_DE_CREAR` (V4.1 desde el 2026-09-14, elegido
 * por Jesús mirando doce páginas) y `escritorDeCrear`. Eran del selector de
 * modelo de Crear y de su ruta, y se fueron con Crear el 2026-10-06
 * (plans/crear-es-len, tarea 12): crear es el primer mensaje a Len, que corre
 * en el papel `agent`.
 */

/**
 * Quién escribe DE VERDAD este turno del Chat: con imagen adjunta, el papel
 * con visión; sin ella, el razonador. Sigue siendo una función y no un `if`
 * suelto porque más de un sitio pregunta lo mismo y la respuesta tiene que ser
 * una.
 */
export function writerForTurn(hasImages: boolean): TurnWriter {
  return hasImages ? "visual_critic" : "reasoner";
}
