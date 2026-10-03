// GET /api/a/owner?code=…&back=/caja — la vuelta del dueño a su página.
//
// Canjea el código de UN uso que acaba de crear openlen.com
// (app/[locale]/(auth)/page-owner/[sub]) por la sesión del dueño en ESTE host
// —la cookie `__Host-` sólo la puede poner él— y lo deja en `back`.
//
// Un GET que cambia algo, a propósito: es la vuelta de una redirección, como
// el `callback` de cualquier OAuth. Lo que lo hace seguro es el código: de un
// uso, de 60 s, de este proyecto, y sólo de su dueño de hoy. Si alguien lo
// cruza con el código de SU proyecto, entra como dueño de su propia página.

import { safeBackPath } from "@/lib/page-accounts/input";
import { pageSubOf } from "../_shared";
import { buildSessionCookie, OWNER_SESSION_TTL_MS, readSessionCookie } from "@/lib/page-accounts/session";
import { loadAccountsSite } from "@/lib/page-accounts/signed-in";
import { createSession, deleteSession, redeemOwnerCode } from "@/lib/page-accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[A-Za-z0-9_-]{43}$/;

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return text("Esto sólo funciona en una página publicada.", 404);
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const back = safeBackPath(url.searchParams.get("back"));

  const site = await loadAccountsSite(sub);
  if (!site?.accounts || !CODE_RE.test(code)) return text("Este enlace no vale. Vuelve a entrar desde la página.", 400);

  const userId = await redeemOwnerCode(site.projectId, code);
  // Se compara con el dueño de AHORA, no con el de cuando se creó el código.
  if (!userId || userId !== site.ownerUserId) {
    return text("Este enlace ya se usó o caducó. Vuelve a entrar desde la página.", 400);
  }

  const previous = readSessionCookie(req.headers);
  if (previous) await deleteSession(previous);
  const token = await createSession({ projectId: site.projectId, ownerUserId: userId, ttlMs: OWNER_SESSION_TTL_MS });
  const h = new Headers({ location: back, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  h.append("set-cookie", buildSessionCookie(token, OWNER_SESSION_TTL_MS));
  return new Response(null, { status: 303, headers: h });
}
