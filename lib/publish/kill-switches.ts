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

// ⚰️ `behaviorsBakeEnabled` / `carouselBakeEnabled` (OPENLEN_BEHAVIORS,
// OPENLEN_CAROUSEL) se fueron el 2026-08-31.
//
// Gobernaban dos horneados que salieron de `filesystem.ts` el 2026-08-26
// (`3a4e2a97`). Desde ese día su ÚNICO consumidor era `/api/flags`, y ese
// endpoint existía sólo para que el taller obedeciera la misma palanca que
// publicar — «una palanca, dos mitades, cero divergencia posible», decía su
// cabecera.
//
// Al quedarse sin la mitad de publicar, la palanca dejó de impedir la
// divergencia y pasó a CREARLA: bajarla no apagaba nada en la página
// publicada, y subida hacía que el taller horneara conductas y carrusel que
// el visitante nunca recibía. Una palanca que no vuelve a ningún sitio.

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

/**
 * La MINIATURA de la tarjeta de proyecto (2026-09-13).
 *
 * Apagarlo no salta ninguna comprobación ni cambia lo que se publica: la
 * tarjeta se queda con su icono y nada más. Lo que se ahorra es un Chromium
 * entero por publicación.
 *
 * POR QUÉ MERECE EXISTIR, que es lo único que le da derecho a estar aquí:
 *
 *   · Es la fuga de perfiles de Puppeteer en `%TEMP%`
 *     ([[puppeteer-deja-458-perfiles-en-temp]]) y son 150-300 MB de Chrome por
 *     pestaña en una CX22. Poder apagarlo en un incidente, sin desplegar,
 *     apunta a algo real.
 *   · `publishProject` lo lanza con `void` —fuego y olvido— y su tope propio es
 *     de 35 s, así que una publicación DEVUELVE mientras deja medio minuto de
 *     render corriendo detrás. MEDIDO el 2026-09-13, cuatro publicaciones
 *     seguidas: 8.840 ms · 57.765 ms · 2.833 ms · 2.774 ms. La segunda no es
 *     lenta por lo que hace; es lenta porque la primera le dejó un Chromium
 *     encima.
 *
 * 🔴 NO ES `OPENLEN_THUMBNAIL_CONCURRENCY=0`, y la diferencia es la misma que
 * documenta `lib/agent/esfuerzo.ts` para `none`: un dial de «cuántos a la vez»
 * con una posición que significa «ninguno» mezcla una CAPACIDAD con una
 * MAGNITUD. Además ese dial hace `Number(…) || 1`, así que el 0 se convierte
 * en 1 en silencio — la peor clase de interruptor: el que parece que apaga.
 */
export function thumbnailsEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_THUMBNAILS !== "0";
}
