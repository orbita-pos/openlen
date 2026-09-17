import "server-only";

// LA URL QUE SE ENSEÑA DE UNA PÁGINA PUBLICADA. Fuente única, lado servidor.
//
// POR QUÉ SE DERIVA Y NO SE LEE. `projects.deployUrl` es una columna, y una
// columna guarda el PASADO: se escribe una sola vez, al publicar, con el host
// de ese momento. Las filas publicadas o sembradas antes del corte del
// 2026-08-23 dicen `<sub>.openlen.com` para siempre, aunque desde el
// 2026-09-10 el único comodín que sirve páginas sea `*.openlen.app`.
//
// `lib/projects.ts` ya derivaba desde el principio. `lib/community/store.ts` no
// — devolvía la columna cruda — y ahí se vio lo que cuesta:
//
//   MEDIDO en producción el 2026-09-17, `openlen.com/es/explore`: las 24
//   tarjetas traían `href="kira.openlen.com"`. Y eso NO es «el dominio viejo
//   con un 308 de más»: la columna se escribe BARE (`${sub}.${host}`, sin
//   esquema — lib/projects.ts, al publicar), así que el navegador la resolvía
//   como RUTA RELATIVA contra la página actual →
//   `https://openlen.com/es/kira.openlen.com` → 404 «Page not found». El
//   redirect del bloque `*.openlen.com` no llegaba a entrar. No iban por la
//   puerta vieja: no iban a ningún sitio.
//
// Derivar cierra las dos cosas a la vez, porque lo derivado trae esquema.
//
// 🔴 NO ES `PUBLISHED_BASE_HOST` (lib/publish/base-host.ts), y la diferencia es
// justo lo que hace falta aquí. Aquél sale de `NEXT_PUBLIC_PUBLISH_BASE_HOST`,
// se hornea en el bundle cuando `next build` corre en el portátil y es lo único
// que puede leer un componente de CLIENTE: sirve para pintar. Éste lee el
// entorno del box en tiempo de ejecución, que es quien manda sobre dónde nace
// una página de verdad.
//
// `server-only` está para que eso no se confunda por accidente. En un
// componente de cliente `process.env.PUBLISH_BASE_HOST` no es que falle: es
// `undefined`, y esto caería mudo al literal viejo pintando el dominio
// equivocado sin que nada se rompiera. Exactamente el fallo que vino a cerrar,
// así que se cierra en la puerta y no con un comentario.

/** Lo que dice el box (`/etc/openlen/openlen.env`), no lo que dice el bundle. */
export function publishBaseHost(): string {
  return process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
}

/**
 * `mitienda` → `https://mitienda.openlen.app`. Absoluta SIEMPRE.
 *
 * Devuelve `null` sin subdominio, y quien llama cae entonces a la columna
 * guardada (`deployUrlFor(sub) ?? row.deployUrl`). Esa caída no es un residuo
 * que limpiar: sin subdominio no hay nada que derivar, y ahí es donde vive un
 * dominio propio.
 */
export function deployUrlFor(subdomain: string | null): string | null {
  if (!subdomain) return null;
  return `https://${subdomain}.${publishBaseHost()}`;
}
