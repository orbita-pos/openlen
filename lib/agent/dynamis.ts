// lib/agent/dynamis.ts — LEN ODYSSEY (`mode: "dynamis"`): el modo con modelo frontier, elegido turno a turno.
//
// 🔴 EVOLUCIÓN (2026-11-25, Jesús): el experimento del 03/10 corría el mismo `DeepSeek V4.1 Flash` que Len
// quitándole Read/Edit/Write («Minimal Mode»: empató en `encargo-grande` y cayó de 3/3 a 1/3 en `hard`,
// editando con heredocs de Python y sin vista previa de `Write`). Ahora Len Odyssey es un SALTO REAL DE MODELO:
//
//   - PAPEL PROPIO `odyssey` en `lib/generation/model-policy.ts`: `Kimi K3.1 Pro` (2,8T total / 104B activos,
//     1M contexto, visión nativa MoonViT-V2), en DeepInfra (`moonshotai/Kimi-K3.1-Pro`, `is_partner: false`)
//     con respaldo en Fireworks (`accounts/fireworks/models/kimi-k3p1-pro`), cobrado a su tarifa real.
//   - HERRAMIENTAS COMPLETAS (Standard Mode, como Kimi Code y Claude Code): conserva Read, Edit, MultiEdit y
//     Write junto con `bash` y los subagentes — así el lienzo sigue pintando en vivo cada `Write`, los tipos y
//     el lint revisan al guardar, y se puede alternar entre Len y Len Odyssey en la misma conversación sin
//     cambiar ni un byte del prompt de sistema, el manual ni las herramientas.
//   - TEMPERATURA 1,0, `top_p` 1,0, `reasoning_effort: "max"` fijo todo el turno (en Kimi cambiarlo a mitad de
//     turno invalida la caché KV) y salida de 65.536 en todas sus llamadas, cierre incluido.
//
// 🔴 EL NOMBRE PÚBLICO ES «LEN ODYSSEY» (Jesús, 03/10/2026). «Dynamis» se queda como nombre INTERNO —el valor
// `dynamis` del cuerpo, el tipo, las pruebas y estos comentarios—, y lo que ve el usuario sale de i18n
// (`composer.modeDynamis`). Detrás de `OPENLEN_DYNAMIS=1` mientras se valida en vivo antes de abrirlo a planes
// de pago.

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

/** La temperatura de la ficha de V4.1. Len usa la misma desde el 21/10 (`brain.ts`, con su porqué). */
export const DYNAMIS_TEMPERATURE = 1.0;

/** La palabra, no un presupuesto: ver la cabecera. */
export const DYNAMIS_REASONING_EFFORT = "max";

/** El techo de salida de cada llamada de un turno Dynamis, cierre incluido. */
export const DYNAMIS_MAX_OUTPUT_TOKENS = 65_536;
