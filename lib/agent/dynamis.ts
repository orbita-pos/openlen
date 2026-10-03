// lib/agent/dynamis.ts — LEN DYNAMIS: el modo a fondo, elegido turno a turno.
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
// ⚰️ SUSTITUYE A `OPENLEN_SOLO_TERMINAL`, la palanca del brazo «sólo terminal»
// de F4, que valía para el servidor entero. Dos mecanismos para quitar las
// mismas herramientas son una palanca que no vuelve a ningún sitio; DeepSeek
// tiene uno, el perfil (`minimal`/`standard`). El banco elige el modo como el
// panel, en el cuerpo de cada turno (`--mode=dynamis` en scripts/len-bench.ts).

import { terminalEncendida } from "./terminal/declaracion";

export const AGENT_MODES = ["len", "dynamis"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** ¿Se puede ofrecer Dynamis? Sólo con la terminal encendida: quitarle a Len
 *  Read, Edit y Write sin darle `bash` lo dejaría sin manos. */
export function dynamisAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return terminalEncendida(env);
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
