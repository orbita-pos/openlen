// POST /api/a/password — poner una contraseña nueva. Dos formas:
//
//   · {"current", "next"} — la cuenta con la que se entró cambia la suya.
//   · {"grant", "next"}   — quien abrió el enlace de recuperar o de invitación
//     (`/api/a/verify` le dio el permiso en `#ol-grant=`). No hace falta haber
//     entrado: el permiso es la prueba, de UN uso y 30 min.
//
// 🔴 CON LA COOKIE SOLA, NO. La primera forma PIDE LA ACTUAL, siempre: con la
// cookie sola bastaría para secuestrar la cuenta —un script de la página, que
// corre con la sesión puesta, la cambiaría sin que nadie supiera la vieja—. Es
// exactamente la vía que cerró el módulo Miembros al retirarse (`set-password`,
// memoria model-js-production-gate). La segunda no la abre: el permiso sólo
// existe si alguien abrió el enlace de SU correo.
//
// Al cambiarla se cierran TODAS sus sesiones y se abre una nueva en este
// navegador: si alguien más la tenía, se queda fuera.

import { checkAndConsume, getClientIp, IP_LIMITS, ipLimitKey } from "@/lib/limits";
import { hashPassword, verifyPassword } from "@/lib/auth/visitor-password";
import { isValidPassword } from "@/lib/page-accounts/input";
import { buildSessionCookie, MEMBER_SESSION_TTL_MS, readSessionCookie } from "@/lib/page-accounts/session";
import { resolveSignedIn } from "@/lib/page-accounts/signed-in";
import {
  createSession,
  deleteAccountSessions,
  deleteSession,
  findAccountForLogin,
  redeemEmailToken,
  setAccountPassword,
  updateAccount,
} from "@/lib/page-accounts/store";
import { fromThisPage, json, pageSubOf, siteWithAccounts } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRANT_RE = /^[A-Za-z0-9_-]{43}$/;

export async function POST(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);

  const byIp = await checkAndConsume(ipLimitKey(getClientIp(req), "page_login"), IP_LIMITS.page_login);
  if (!byIp.ok) return json({ error: "rate_limited" }, 429);

  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  let body: { current?: unknown; next?: unknown; grant?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const next = typeof body.next === "string" ? body.next : "";

  if (body.grant !== undefined) {
    // Antes de gastar el permiso: una contraseña corta no lo quema.
    if (!isValidPassword(next)) return json({ error: "weak_password" }, 422);
    const grant = typeof body.grant === "string" && GRANT_RE.test(body.grant) ? body.grant : null;
    const redeemed = grant ? await redeemEmailToken(site.projectId, grant, ["set_password"]) : null;
    if (!redeemed) return json({ error: "invalid_grant" }, 401);
    const account = await setAccountPassword(site.projectId, redeemed.email, await hashPassword(next));
    // La borró el dueño entre el correo y ahora.
    if (!account) return json({ error: "invalid_grant" }, 401);
    await deleteAccountSessions(site.projectId, account.id);
    const previous = readSessionCookie(req.headers);
    if (previous) await deleteSession(previous);
    const token = await createSession({ projectId: site.projectId, memberId: account.id, ttlMs: MEMBER_SESSION_TTL_MS });
    return json({ ok: true }, 200, [buildSessionCookie(token, MEMBER_SESSION_TTL_MS)]);
  }

  const signedIn = await resolveSignedIn(req.headers, site);
  if (!signedIn) return json({ error: "not_signed_in" }, 401);
  // El dueño no tiene contraseña aquí: entra con la de OpenLen.
  if (signedIn.actor.tipo !== "cuenta" || !signedIn.account) return json({ error: "owner_uses_openlen" }, 400);

  const current = typeof body.current === "string" ? body.current : "";
  if (!isValidPassword(next)) return json({ error: "weak_password" }, 422);

  const account = await findAccountForLogin(site.projectId, signedIn.account.email);
  if (!account?.passwordHash || !(await verifyPassword(current, account.passwordHash))) {
    return json({ error: "invalid_credentials" }, 401);
  }

  await updateAccount(site.projectId, account.id, { passwordHash: await hashPassword(next) });
  await deleteAccountSessions(site.projectId, account.id);
  const token = await createSession({ projectId: site.projectId, memberId: account.id, ttlMs: MEMBER_SESSION_TTL_MS });
  return json({ ok: true }, 200, [buildSessionCookie(token, MEMBER_SESSION_TTL_MS)]);
}
