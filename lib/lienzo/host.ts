// EL HOST DEL LIENZO — la única fuente, como `lib/publish/base-host.ts` lo es
// del de publicación.
//
// El lienzo del taller carga la página desde un origen de verdad y de OTRO
// sitio que openlen.com: `lienzo-<id>.openlen.app`. Es la forma de la acción
// `preview` de Claude Code (la página en `p<uuid>.localhost`, dentro de
// un envoltorio de otro origen) y de v0 (el despliegue en `*.vercel.app`). Ver
// docs/superpowers/specs/2026-09-15-un-solo-camino-de-renderizado-design.md.
//
// ⚠️ SÓLO TRES DE LAS NUEVE EXPORTACIONES SON DE CLIENTE: `LIENZO_PREFIJO`,
// `etiquetaDeLienzo` y `etiquetaDelHost`, que son puras. Ésas son las que
// importa `lib/subdomain/validate.ts`, que sí corre en el cliente.
//
// Las otras seis leen el entorno por su parámetro `env`, cuyo defecto es
// `process.env`, así que llamarlas desde un componente de cliente leería un
// entorno que allí casi no existe. Del cliente sale el PREFIJO; las URLs y las
// cabeceras las arma el servidor.

export const LIENZO_PREFIJO = "lienzo-";

type Entorno = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `4f9c10cb-8781-…` → `lienzo-4f9c10cb8781…` (7 + 32 = 39 caracteres). */
export function etiquetaDeLienzo(projectId: string): string | null {
  if (!UUID.test(projectId)) return null;
  return LIENZO_PREFIJO + projectId.replace(/-/g, "").toLowerCase();
}

/** La etiqueta de lienzo del primer tramo de un host, o null si no lo es. */
export function etiquetaDelHost(host: string | null | undefined): string | null {
  const nombre = String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!nombre.includes(".")) return null;
  const primera = nombre.split(".")[0] ?? "";
  return /^lienzo-[0-9a-f]{32}$/.test(primera) ? primera : null;
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

/** La URL completa del documento. `hostDeLaPeticion` es el Host del POST; en
 *  desarrollo sólo se usa su puerto. `null` si no se puede construir. */
export function urlDelDocumento(
  input: { projectId: string; docId: string; hostDeLaPeticion: string | null },
  env: Entorno = process.env,
): string | null {
  const etiqueta = etiquetaDeLienzo(input.projectId);
  if (!etiqueta) return null;
  const ruta = `/api/lienzo/${encodeURIComponent(input.docId)}`;
  if (esProduccion(env)) {
    const base = lienzoBaseHost(env);
    return base ? `https://${etiqueta}.${base}${ruta}` : null;
  }
  const puerto = /:(\d+)$/.exec(String(input.hostDeLaPeticion ?? ""))?.[1];
  return `http://${etiqueta}.localhost${puerto ? `:${puerto}` : ""}${ruta}`;
}

/** Palanca de despliegue: `OPENLEN_LIENZO_ORIGEN=0` devuelve a todos al
 *  `srcdoc` con la banda. Su destino es el camino de reserva, que existe y
 *  tiene su columna en la matriz. Si el `srcdoc` se retira, esto se va con él. */
export function lienzoApagado(env: Entorno = process.env): boolean {
  return env.OPENLEN_LIENZO_ORIGEN?.trim() === "0";
}
