// GET /api/a/verify?token=… — el enlace de los correos de las cuentas.
//
// Un GET que cambia algo, como `/api/a/owner` y el `/verify` de Supabase: es un
// enlace que se abre desde el correo, así que no hay `Origin` que comparar. Lo
// que lo hace seguro es la ficha: de un uso, con plazo, de ESTE proyecto y de un
// tipo que este camino canjea. Vuelve a la página (303) con lo que pasó en el
// FRAGMENTO —el servidor no lo ve y no viaja en el `Referer`—:
//
//   · confirmar  → la cuenta se activa y queda dentro: `#ol-auth=confirmed`.
//   · recuperar / invitación → `#ol-auth=recovery&ol-grant=<permiso>` (o
//     `invite`): un permiso de un uso y 30 min con el que la página pide la
//     contraseña nueva a `/api/a/password` (`{grant, next}`).
//   · ficha mala, usada o caducada → `/#ol-auth=invalid`, sin cookie.
//
// 🔴 Se gasta AL ABRIRLO, como en Supabase por defecto. Hay filtros de correo
// (Outlook) que abren los enlaces antes que la persona; entonces se pide otro.
//
// La `Location` es RELATIVA, como la de `/api/a/owner`: el navegador se queda en
// el host por el que llegó, y la ruta sale de la ficha (`safeBackPath` al
// crearla), nunca de lo que traiga el enlace.

import {
  buildSessionCookie,
  EMAIL_TOKEN_TTL_MS,
  MEMBER_SESSION_TTL_MS,
  readSessionCookie,
} from "@/lib/page-accounts/session";
import { loadAccountsSite } from "@/lib/page-accounts/signed-in";
import { confirmAccount, createEmailToken, createSession, deleteSession, markLogin, redeemEmailToken } from "@/lib/page-accounts/store";
import { safeBackPath } from "@/lib/page-accounts/input";
import { pageSubOf } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function back(path: string, fragment: string, cookie?: string): Response {
  const h = new Headers({
    location: `${safeBackPath(path)}#${fragment}`,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (cookie) h.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers: h });
}

export async function GET(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) {
    return new Response("Esto sólo funciona en una página publicada.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const site = await loadAccountsSite(sub);
  if (!site?.accounts || !TOKEN_RE.test(token)) return back("/", "ol-auth=invalid");

  const redeemed = await redeemEmailToken(site.projectId, token, ["confirm", "recovery", "invite"]);
  if (!redeemed) return back("/", "ol-auth=invalid");

  if (redeemed.purpose === "confirm") {
    const account = await confirmAccount(site.projectId, redeemed.email);
    if (!account) return back("/", "ol-auth=invalid");
    // Entrar siempre estrena: la sesión que hubiera en este navegador se cierra.
    const previous = readSessionCookie(req.headers);
    if (previous) await deleteSession(previous);
    const session = await createSession({ projectId: site.projectId, memberId: account.id, ttlMs: MEMBER_SESSION_TTL_MS });
    await markLogin(account.id);
    return back(redeemed.backPath, "ol-auth=confirmed", buildSessionCookie(session, MEMBER_SESSION_TTL_MS));
  }

  // Recuperar o invitación: abrir el enlace prueba el correo, y da el permiso de
  // un uso para poner la contraseña. Nada más: la contraseña la pone la página.
  const grant = await createEmailToken({
    projectId: site.projectId,
    email: redeemed.email,
    purpose: "set_password",
    backPath: redeemed.backPath,
    ttlMs: EMAIL_TOKEN_TTL_MS.set_password,
  });
  return back(redeemed.backPath, `ol-auth=${redeemed.purpose}&ol-grant=${grant}`);
}
