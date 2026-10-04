// lib/agent/dynamis.ts — LEN DYNAMIS: el modo a fondo, elegido turno a turno.
//
// 🅿️ APARCADO (Jesús, 03/10/2026): «no fue un fracaso porque aprendimos de Len
// Odyssey, sólo que aún no está listo para salir… dejarlo ahí tranquilo, con sus
// datos, para enfocarnos en sacar Len 2.5». Los datos, en
// plans/len-2/corridas/2026-10-03-dynamis/README.md: en el encargo grande empata
// con 2.5 (1,00) a ×1,6 de coste; en el juego `hard` (× 1) pierde, 1/3 contra
// 3/3, a ×1,9 de coste y ×1,7 de tiempo — piensa ×11 por llamada y verifica
// MENOS (71 pasos contra 94), y sus dos fallos fueron de comportamiento. Lo que
// falta por medir, si vuelve: los 5 encargos donde 2.5 falla a veces (8/15).
//
// Por eso NO sale con la terminal: Len 2.5 la enciende en producción
// (`OPENLEN_TERMINAL=1`) y, sin más, el selector aparecería en el chat de todos.
// Hace falta ADEMÁS `OPENLEN_DYNAMIS=1` (`dynamisAvailable`). No es una palanca
// sin destino: detrás está el modo entero, probado y medido. Si un día se
// retira, la palanca se va con él en el mismo barrido (memoria
// `la-palanca-que-no-vuelve-a-ningun-sitio`). Para medirlo en el banco, el
// servidor de Len-Bench se arranca con las dos.
//
// 🔴 EL NOMBRE PÚBLICO ES «LEN ODYSSEY» (Jesús, 03/10/2026). «Dynamis» se queda
// como nombre INTERNO —el valor `dynamis` del cuerpo, el tipo, las pruebas y
// estos comentarios—, y lo que ve el usuario sale de i18n (`composer.modeDynamis`).
// Por qué se cambió: en EE. UU. OmNova, LLC tiene pendiente DYNAMIS (50017818,
// clases 9 y 42) para agentes de IA, lo mismo que Len (búsqueda en
// plans/len-2/corridas/2026-10-03-dynamis/README.md). Como Anthropic con «Claude
// Opus», el nombre va siempre detrás de la marca de casa: «Len Odyssey».
//
// Decisión de Jesús (03/10/2026): Len 2.5 es el Len de todos los días, y Len
// Dynamis (δύναμις, «poder, potencia») un MODO aparte que convive con él, como
// el modo Minimal de DeepSeek convive con su Standard. Es la receta con la que
// DeepSeek evaluó V4.1, el modelo de Len, y donde sacó sus mejores números
// (plans/len-agente-2026/notas/fase-2-deepseek.md §1 y §5):
//
//   - SÓLO LA TERMINAL PARA LOS FICHEROS: sin Read, Edit ni Write (Grep y Glob
//     ya salen con la terminal). Lo que no es de ficheros se queda —mirar y
//     usar la página, publicar, la web, preguntar—: Len no trabaja en un
//     contenedor de código, trabaja en la web de alguien.
//   - TEMPERATURA 1,0, la de todas las evaluaciones de la ficha.
//   - `reasoning_effort: "max"`, LA PALABRA. Los números que manda el mando de
//     esfuerzo son un TOPE de pensamiento en Fireworks (`esfuerzo.ts`); la
//     palabra es la que la plantilla de V4.1 convierte en «Reasoning Effort:
//     100», y Len no la había mandado nunca (F3 de HOJA-DE-RUTA.md, aparcada).
//   - SALIDA DE 65.536 en todas sus llamadas, cierre incluido. Con el
//     razonamiento al máximo, 32.768 corta (los 8 cortes de 2.0 fueron de
//     razonamiento desbocado) y los 2.048 del cierre se irían en pensar. Es lo
//     que Fireworks ya acepta con este modelo en /api/generate; el arnés de
//     DeepSeek usa 256.000 para todo, sin comprobar en Fireworks. Sólo se paga
//     lo que se usa.
//   - `top_p` NO: DeepSeek lo quitó de su arnés por inerte («sampling is
//     temperature/maxTokens/stop only», packages/llm/llm/README.md).
//
// VIAJA CON EL TURNO, como el esfuerzo (el pestillo por turno de
// `app/api/agent/route.ts`): el panel lo manda en el cuerpo, la ruta lo sanea
// con `modeOfTurn` y de ahí llega al catálogo, al prompt, al manual —también al
// /AGENTS.md que lee la terminal— y al cable. Sin él, todo sale byte a byte
// como en Len 2.5.
//
// EL PRECIO (Jesús, 03/10/2026): «paga lo que usa». Las mismas tarifas y los
// mismos techos por turno que Len (`lib/credits.ts`: los créditos ya se cobran
// por tokens a la tarifa del papel `agent`), sin recargo ni regla aparte: lo que
// piensa de más se paga solo. Medido en la sonda: un encargo grande, ~10
// créditos contra ~6 (plans/len-2/corridas/2026-10-03-dynamis). El selector lo
// dice («gasta más créditos»). Por eso aquí no hay ninguna constante de precio.
//
// ⚰️ SUSTITUYE A `OPENLEN_SOLO_TERMINAL`, la palanca del brazo «sólo terminal»
// de F4, que valía para el servidor entero. Dos mecanismos para quitar las
// mismas herramientas son una palanca que no vuelve a ningún sitio; DeepSeek
// tiene uno, el perfil (`minimal`/`standard`). El banco elige el modo como el
// panel, en el cuerpo de cada turno (`--mode=dynamis` en scripts/len-bench.ts).

import { terminalEncendida } from "./terminal/declaracion";

export const AGENT_MODES = ["len", "dynamis"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** ¿Se puede ofrecer Dynamis? Sólo si se pide a propósito —está APARCADO, ver
 *  la cabecera— y con la terminal encendida: quitarle a Len Read, Edit y Write
 *  sin darle `bash` lo dejaría sin manos. */
export function dynamisAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_DYNAMIS?.trim() === "1" && terminalEncendida(env);
}

/** El modo de ESTE turno, saneado: entra de fuera. Cualquier otra cosa —o
 *  Dynamis con la terminal apagada— es Len. */
export function modeOfTurn(raw: unknown, env: Readonly<Record<string, string | undefined>> = process.env): AgentMode {
  return raw === "dynamis" && dynamisAvailable(env) ? "dynamis" : "len";
}

/** La temperatura de la ficha de V4.1. La de Len, 0,2, está en `brain.ts` con su porqué. */
export const DYNAMIS_TEMPERATURE = 1.0;

/** La palabra, no un presupuesto: ver la cabecera. */
export const DYNAMIS_REASONING_EFFORT = "max";

/** El techo de salida de cada llamada de un turno Dynamis, cierre incluido. */
export const DYNAMIS_MAX_OUTPUT_TOKENS = 65_536;
