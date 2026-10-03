// ¿Viene esta petición de la PROPIA página? La versión estricta de
// `checkSubdomainOrigin` (lib/publish/request-origin.ts), para todo lo que
// toca una sesión.
//
// POR QUÉ NO BASTA LA OTRA. Aquélla deja pasar lo que no sabe identificar,
// porque la usan todos los formularios publicados y dejar a alguien sin enviar
// es peor que el riesgo que cierra. Aquí es al revés: con la sesión de una caja
// puesta, `tienda.openlen.app` y `malo.openlen.app` son el mismo SITIO para el
// navegador —`openlen.app` no está en la Public Suffix List—, así que la cookie
// `SameSite=Lax` SÍ viaja en un POST de una a otra. Lo único que las distingue
// es el `Origin`. Por eso:
//
//   · sin `Origin` (o `null`) → no. Un navegador lo manda siempre en un POST,
//     PATCH o DELETE; si falta, no es la página.
//   · NUNCA se cae al `Host`, como hace `requestingHost`: el `Host` es el de
//     DESTINO, y comparado consigo mismo siempre «coincide».
//   · `Sec-Fetch-Site`, si viene, tiene que ser `same-origin`. `same-site` es
//     justo el subdominio hermano.

import { checkSubdomainOrigin } from "@/lib/publish/request-origin";

/** Para las LECTURAS (GET), donde un navegador no manda `Origin` aunque la
 *  petición sea de la propia página: si dice de dónde viene, tiene que ser de
 *  aquí. Lo que se lea desde otro origen no lo puede ver de todas formas: estas
 *  rutas no mandan cabeceras CORS. */
export function isSameOriginRead(headers: { get(name: string): string | null }): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

export async function isSameOriginRequest(input: {
  readonly headers: { get(name: string): string | null };
  readonly targetSub: string;
  readonly baseHost: string | readonly string[];
  readonly resolveCustomDomain: (host: string) => Promise<string | null>;
}): Promise<boolean> {
  const fetchSite = input.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;

  const origin = input.headers.get("origin");
  if (!origin || origin === "null") return false;

  const check = await checkSubdomainOrigin({
    headers: { get: (name) => (name.toLowerCase() === "origin" ? origin : null) },
    targetSub: input.targetSub,
    baseHost: input.baseHost,
    resolveCustomDomain: input.resolveCustomDomain,
  });
  return check.kind === "match";
}
