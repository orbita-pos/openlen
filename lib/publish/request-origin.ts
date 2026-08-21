// ¿Viene esta petición de la página del proyecto al que dice ir?
//
// EL RELÉ QUE ESTO CIERRA. Las rutas públicas de una página publicada eligen el
// proyecto destino por lo que trae la RUTA (`/api/f/<sub>`, `/c/<projectId>`),
// sin mirar desde dónde se pidió. Como todas se sirven bajo cada subdominio, un
// script en `victima.openlen.com` puede mandar datos a `/api/f/atacante` y caen
// en la bandeja del atacante. Para la CSP eso es `'self'`: `connect-src` no lo
// ve, `form-action 'self'` tampoco. Es un relé de exfiltración entre proyectos
// que ninguna política de contenido puede detectar.
//
// Hoy está latente —no hay scripts ajenos en páginas publicadas— pero cualquier
// XSS futuro, o el piloto de JavaScript del modelo, lo activa.
//
// LA REGLA ES CONSERVADORA A PROPÓSITO: se rechaza sólo ante un desajuste
// POSITIVO, y lo que no se puede identificar se deja pasar. Este endpoint lo
// usan TODOS los formularios publicados; dejar sin enviar a alguien por un caso
// que no supimos leer sería un fallo peor y más visible que el riesgo que
// cerramos. El ataque sí queda cerrado, porque la página del atacante tiene un
// host perfectamente identificable que no coincide.

/** De dónde dice el navegador que viene. `Origin` primero: en un POST el
 *  navegador lo manda siempre y no lo puede falsear una página. `Host` es el
 *  respaldo (Caddy preserva el original al reenviar a Node). */
export function requestingHost(headers: {
  get(name: string): string | null;
}): string | null {
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      /* cae al Host */
    }
  }
  const host = headers.get("host");
  if (!host) return null;
  // `host` puede traer puerto.
  const limpio = host.split(":")[0]?.trim().toLowerCase();
  return limpio && limpio !== "" ? limpio : null;
}

export type OriginCheck =
  /** Viene de donde dice ir. */
  | { readonly kind: "match" }
  /** Viene de OTRO proyecto. Es el relé, y se rechaza. */
  | { readonly kind: "mismatch"; readonly from: string }
  /** No se pudo identificar: la app, un dominio que no conocemos, sin cabeceras.
   *  Se deja pasar y se registra. */
  | { readonly kind: "unknown"; readonly from: string | null };

/**
 * Compara el subdominio que pide con el subdominio destino.
 *
 * `resolveCustomDomain` traduce un dominio propio a su subdominio de OpenLen;
 * devuelve `null` si no lo conoce. Se inyecta para que esto se pueda probar sin
 * base de datos.
 */
export async function checkSubdomainOrigin(input: {
  readonly headers: { get(name: string): string | null };
  readonly targetSub: string;
  readonly baseHost: string;
  readonly resolveCustomDomain: (host: string) => Promise<string | null>;
}): Promise<OriginCheck> {
  const from = requestingHost(input.headers);
  if (!from) return { kind: "unknown", from: null };

  const base = input.baseHost.toLowerCase();
  const objetivo = input.targetSub.toLowerCase();

  if (from === base || from === `www.${base}`) {
    // El propio host de la aplicación: la vista previa del editor y los
    // enlaces de borrador viven ahí. No es una página publicada de nadie.
    return { kind: "unknown", from };
  }
  if (from.endsWith(`.${base}`)) {
    const sub = from.slice(0, -(base.length + 1));
    // Un subdominio anidado ("a.b.openlen.com") no es una página publicada.
    if (sub.includes(".")) return { kind: "unknown", from };
    return sub === objetivo ? { kind: "match" } : { kind: "mismatch", from };
  }

  // Dominio propio. Si lo conocemos, tiene que apuntar a este mismo proyecto.
  const suyo = await input.resolveCustomDomain(from);
  if (suyo === null) return { kind: "unknown", from };
  return suyo.toLowerCase() === objetivo ? { kind: "match" } : { kind: "mismatch", from };
}

/**
 * El resolutor real: dominio propio → subdominio de OpenLen del proyecto dueño.
 *
 * Se importa perezosamente para que este módulo siga siendo puro y comprobable
 * sin base de datos, y para que el coste sólo lo pague la petición que llega
 * desde un dominio que no reconocemos como subdominio nuestro — es decir, casi
 * ninguna.
 */
export async function resolveCustomDomainSub(host: string): Promise<string | null> {
  try {
    const [{ db, schema }, { eq }] = await Promise.all([
      import("@/lib/db"),
      import("drizzle-orm"),
    ]);
    const filas = await db
      .select({ sub: schema.projects.subdomain })
      .from(schema.customDomains)
      .innerJoin(schema.projects, eq(schema.customDomains.projectId, schema.projects.id))
      .where(eq(schema.customDomains.domain, host))
      .limit(1);
    return filas[0]?.sub ?? null;
  } catch {
    // Un fallo de base de datos NO puede convertirse en un rechazo: devolver
    // null lo deja en "desconocido", que pasa. Cerrar aquí dejaría sin
    // formularios a todo el mundo durante una incidencia de la base de datos.
    return null;
  }
}

/** El subdominio publicado de un proyecto, o `null` si no lo tiene o falla la
 *  consulta. Mismo criterio que arriba: un fallo de base de datos deja el caso
 *  en "desconocido", nunca en rechazo. */
export async function subdomainOfProject(projectId: string): Promise<string | null> {
  try {
    const [{ db, schema }, { eq }] = await Promise.all([
      import("@/lib/db"),
      import("drizzle-orm"),
    ]);
    const filas = await db
      .select({ sub: schema.projects.subdomain })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    return filas[0]?.sub ?? null;
  } catch {
    return null;
  }
}
