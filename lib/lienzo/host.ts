// EL HOST DEL LIENZO — la única fuente, como `lib/publish/base-host.ts` lo es
// del de publicación.
//
// El lienzo del taller carga la página desde un origen de verdad y de OTRO
// sitio que openlen.com: `lienzo-<id>.openlen.app`. Es la forma de la acción
// `preview` de Claude Code (la página en `p<uuid>.localhost`, dentro de
// un envoltorio de otro origen) y de v0 (el despliegue en `*.vercel.app`). Ver
// docs/superpowers/specs/2026-09-15-un-solo-camino-de-renderizado-design.md.
//
// ⚠️ SÓLO DE SERVIDOR desde la pieza 9 de Len 2.5: la etiqueta es un HMAC
// (`node:crypto`). Lo puro —`LIENZO_PREFIJO` y `etiquetaDelHost`— vive en
// `prefijo.ts` y se reexporta aquí; el cliente (`lib/subdomain/validate.ts`) y
// el middleware (que corre en el borde) lo importan de allí, nunca de aquí.
//
// Todo lo demás lee el entorno por su parámetro `env`, cuyo defecto es
// `process.env`: las URLs y las cabeceras las arma el servidor.

import { createHmac } from "node:crypto";
import { LIENZO_PREFIJO } from "./prefijo";

export { LIENZO_PREFIJO, etiquetaDelHost } from "./prefijo";

type Entorno = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `lienzo-` + 32 hex de `HMAC-SHA256(AUTH_SECRET, "openlen-lienzo:" + id)`
 * (7 + 32 = 39 caracteres, cabe en una etiqueta DNS).
 *
 * 🔴 NO ES EL ID (pieza 9 de Len 2.5). Hasta entonces era el UUID sin guiones.
 * Con el sitio entero en el host —la página en su ruta y los ficheros de la
 * carpeta—, el HOST es la llave de lo que el dueño aún no ha publicado, y el id
 * del proyecto lo enseña la analítica de cualquier página publicada
 * (`lib/analytics/snippet.ts`). Con el HMAC no se adivina.
 *
 * Sin secreto no hay etiqueta: el lienzo cae a la reserva (`srcdoc`), que es
 * lo que ya pasa sin dominio de lienzo.
 *
 * El secreto es el de Auth.js, con sus dos nombres: `NEXTAUTH_SECRET` es el que
 * tienen la caja y el `.env.local`. Leer sólo `AUTH_SECRET` dejó todos los
 * editores de producción en la reserva tras el deploy de 2.5 (06/10).
 */
export function etiquetaDeLienzo(projectId: string, env: Entorno = process.env): string | null {
  const secreto = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
  if (!secreto || !UUID.test(projectId)) return null;
  const huella = createHmac("sha256", secreto).update(`openlen-lienzo:${projectId.toLowerCase()}`).digest("hex");
  return LIENZO_PREFIJO + huella.slice(0, 32);
}

export function esProduccion(env: Entorno = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** Bajo qué dominio vive el lienzo en producción. `null` = sin configurar.
 *  Por defecto sale de PUBLISH_BASE_HOST: el literal `openlen.com` que usa
 *  `publishBaseHost()` MIENTE sobre producción (medido el 2026-08-26). */
export function lienzoBaseHost(env: Entorno = process.env): string | null {
  return env.LIENZO_BASE_HOST?.trim() || env.PUBLISH_BASE_HOST?.trim() || null;
}

/** El origen de la app: el único que puede enmarcar el lienzo. Mismo defecto
 *  que `submitBase()` en `lib/publish/forms.ts`. */
export function origenDeLaApp(env: Entorno = process.env): string {
  try {
    return new URL(env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com").origin;
  } catch {
    return "https://openlen.com";
  }
}

/** Valor de `frame-ancestors`. En desarrollo se añade localhost: sin
 *  NEXT_PUBLIC_SITE_URL el defecto bloquearía el taller local. */
export function frameAncestors(env: Entorno = process.env): string {
  const app = origenDeLaApp(env);
  return esProduccion(env) ? app : `${app} http://localhost:*`;
}

/**
 * La URL completa del documento. `hostDeLaPeticion` es el Host del POST; en
 * desarrollo sólo se usa su puerto. `null` si no se puede construir.
 *
 * LA RUTA ES LA DE LA PUBLICADA (pieza 9 de Len 2.5): la home en `/`, una
 * página en `/<slug>/index.html`, para que `js/app.js` relativo y `/data/…`
 * se resuelvan como allí. `?__lienzo=` elige el documento exacto —lo que el
 * dueño tiene en pantalla—, sin carreras entre pestañas.
 *
 * ⚠️ `index.html` y no `/<slug>/`: Next redirige toda ruta con barra final a la
 * misma sin barra ANTES del middleware (`load-custom-routes`, la redirección
 * interna de `trailingSlash: false`), y desde `/menu` lo relativo se resolvería
 * desde la raíz. `/menu/index.html` también la sirve la publicada (el
 * `try_files` del Caddyfile), con la misma base que `/menu/`.
 */
export function urlDelDocumento(
  input: { projectId: string; docId: string; pagina: string | null; hostDeLaPeticion: string | null },
  env: Entorno = process.env,
): string | null {
  const etiqueta = etiquetaDeLienzo(input.projectId, env);
  if (!etiqueta) return null;
  const camino = input.pagina ? `/${encodeURIComponent(input.pagina)}/index.html` : "/";
  const ruta = `${camino}?${LIENZO_PARAM}=${encodeURIComponent(input.docId)}`;
  // Un build de producción corrido EN LOCAL (el ensayo de caja) también es
  // producción, pero su borrador vive aquí: el dominio de lienzo es de la caja.
  if (esProduccion(env) && !esPeticionLocal(input.hostDeLaPeticion)) {
    const base = lienzoBaseHost(env);
    return base ? `https://${etiqueta}.${base}${ruta}` : null;
  }
  const puerto = /:(\d+)$/.exec(String(input.hostDeLaPeticion ?? ""))?.[1];
  return `http://${etiqueta}.localhost${puerto ? `:${puerto}` : ""}${ruta}`;
}

/** ¿El Host de la petición es de esta máquina? (`localhost`, `127.0.0.1`,
 *  `[::1]`, `*.localhost`). En la caja llega el público: Caddy lo pasa tal cual. */
function esPeticionLocal(host: string | null): boolean {
  const h = String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

/** El parámetro de la URL del lienzo que elige el documento. */
export const LIENZO_PARAM = "__lienzo";

/** Palanca de despliegue: `OPENLEN_LIENZO_ORIGEN=0` devuelve a todos al
 *  `srcdoc` con la banda. Su destino es el camino de reserva, que existe y
 *  tiene su columna en la matriz. Si el `srcdoc` se retira, esto se va con él. */
export function lienzoApagado(env: Entorno = process.env): boolean {
  return env.OPENLEN_LIENZO_ORIGEN?.trim() === "0";
}
