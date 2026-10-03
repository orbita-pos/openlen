// Lo común a las rutas de CUENTAS de una página (plans/page-accounts/design.md).
//
// Hermanas de /api/d (datos) y con su misma forma: cáscaras que encadenan
// módulos probados sin red —la declaración, la sesión, la procedencia, el
// actor— y los traducen a códigos HTTP. Viven bajo `/api/a/` y Caddy las pasa a
// Next desde el comodín de las páginas (`handle /api/a/*`).
//
// 🔴 SIN EL SUBDOMINIO EN LA RUTA, a propósito: la página no sabe con qué
// subdominio se publicará —un borrador no lo tiene—, y pedírselo es el fallo
// del carrito del 2026-09-18 (`/api/d/carrito/carrito`, app/api/d/[sub]/route.ts).
// El sitio sale del HOST al que va la petición (`pageSubOf`).

import {
  publishedBaseHosts,
  resolveCustomDomainSub,
  subDeLaPagina,
} from "@/lib/publish/request-origin";
import { isSameOriginRead, isSameOriginRequest } from "@/lib/page-accounts/same-origin";
import type { SignedInActor } from "@/lib/page-accounts/actor";
import type { PageAccount } from "@/lib/page-accounts/store";
import { loadAccountsSite, type AccountsSite } from "@/lib/page-accounts/signed-in";
import type { AccountsDeclaration } from "@/lib/page-accounts/declaration";

export function json(body: unknown, status: number, cookies: readonly string[] = []): Response {
  const h = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** El subdominio de la página a la que va la petición, o `null` si no es una
 *  página publicada (la app, un host que no conocemos).
 *
 *  Del `Host` y SÓLO del `Host` —Caddy lo conserva al reenviar—, no del
 *  `Origin` como `/api/d/<almacén>`: aquí el `Origin` es lo que se COMPARA
 *  (`fromThisPage`), y sacar de él el sitio dejaría que `malo.openlen.app`
 *  entrase en SUS cuentas contra el host de `tienda` y le plantase allí su
 *  cookie, encima de la de la cajera. */
export function pageSubOf(req: Request): Promise<string | null> {
  return subDeLaPagina({
    headers: { get: (name) => (name.toLowerCase() === "host" ? req.headers.get("host") : null) },
    baseHost: publishedBaseHosts(),
    resolveCustomDomain: resolveCustomDomainSub,
  });
}

/** Todo lo que CAMBIA algo exige venir de la propia página (same-origin.ts). */
export function fromThisPage(req: Request, sub: string): Promise<boolean> {
  return isSameOriginRequest({
    headers: req.headers,
    targetSub: sub,
    baseHost: publishedBaseHosts(),
    resolveCustomDomain: resolveCustomDomainSub,
  });
}

/** Para las lecturas (GET): ver `isSameOriginRead`. */
export function readFromThisPage(req: Request): boolean {
  return isSameOriginRead(req.headers);
}

/** El sitio con sus cuentas, o la respuesta con la que cortar. */
export async function siteWithAccounts(
  sub: string,
): Promise<Response | (AccountsSite & { accounts: AccountsDeclaration })> {
  const site = await loadAccountsSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  // Sin `data-ol-accounts` en lo PUBLICADO no hay cuentas. El nombre del error
  // dice qué falta, para quien escribe la página.
  if (!site.accounts) return json({ error: "accounts_not_declared" }, 404);
  return site as AccountsSite & { accounts: AccountsDeclaration };
}

/** Lo que la página puede saber de una cuenta. Nunca el hash. */
export function publicAccount(account: PageAccount, actor?: SignedInActor) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    // El papel QUE VALE: uno que la página ya no declara sale como null.
    role: actor?.tipo === "cuenta" ? actor.papel : account.role,
  };
}
