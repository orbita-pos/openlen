// EL predicado único de los kill-switches de runtimes horneados (hallazgo
// Fable, 2026-07-13). Antes, OPENLEN_BEHAVIORS=0 se leía inline SOLO en
// publishToDir — el inyector del preview (client component, no puede leer
// process.env) seguía inyectando, así que la palanca de rollback hacía
// divergir editor y publicado. OPENLEN_CAROUSEL tenía el mismo hueco.
//
// Dos consumidores, un predicado: lib/publish/filesystem.ts (el bake de
// publish) y app/api/flags/route.ts (lo que el preview consulta vía
// use-kill-switches.ts). Si alguna vez cambia la semántica ("0" apaga, todo
// lo demás enciende), cambia aquí y las dos mitades se mueven juntas.
//
// `env` inyectable solo para tests — el call site real nunca pasa argumento.

// Record plano y no NodeJS.ProcessEnv: el ProcessEnv aumentado del repo exige
// NODE_ENV, y los tests pasan objetos mínimos. process.env es asignable.
type EnvLike = Record<string, string | undefined>;

export function behaviorsBakeEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_BEHAVIORS !== "0";
}

export function carouselBakeEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_CAROUSEL !== "0";
}

/** Transform de ingestión (spec 2026-07-14) — bake quirúrgico + translate en
 *  from-template/from-html. Corre en INGESTIÓN (antes de guardar), no toca
 *  preview ni publish, así que este es su único consumidor de palanca. */
export function transformEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_TRANSFORM !== "0";
}

/** Datos vivos (spec 2026-07-14) — página publicada mostrando datos de un
 *  Google Sheet público, refrescados en horario. */
export function liveDataEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_LIVE_DATA !== "0";
}

/**
 * Los objetivos de op `styles` y `head` (2026-08-22) — el CSS y la hoja de
 * fuentes alcanzables sin reescribir la página.
 *
 * Apagarlo devuelve las TRES mitades a la vez, que es la única forma de que un
 * interruptor sirva: el reparto en `splitDocumentOps` deja de apartar las ops
 * (caen al aplicador, que las rechaza como cualquier target inexistente), y las
 * dos superficies dejan de anunciar los objetivos en su prompt. Anunciar un
 * camino apagado es peor que no tenerlo — el modelo lo emite y desaparece.
 *
 * Existe además porque es el BRAZO DE CONTROL de la medición: sin poder apagar
 * lo nuevo, «0 de 9 reescribió la página» no significa nada, porque nadie sabe
 * cuántas reescribía antes.
 */
export function documentOpsEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_DOC_OPS !== "0";
}
