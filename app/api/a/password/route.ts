// POST /api/a/password — cambiar la contraseña de la cuenta con la que se
// entró. Cuerpo: {"current": "...", "next": "..."}.
//
// 🔴 PIDE LA ACTUAL, siempre. Con la cookie sola bastaría para secuestrar la
// cuenta: un script de la página —que corre con la sesión puesta— la
// cambiaría sin que nadie supiera la vieja. Es exactamente la vía que cerró
// el módulo Miembros al retirarse (`set-password`, memoria
// model-js-production-gate), y por eso aquí no existe.
//
// Al cambiarla se cierran TODAS sus sesiones y se abre una nueva en este
// navegador: si alguien más la tenía, se queda fuera.

import { checkAndConsume, getClientIp, IP_LIMITS, ipLimitKey } from "@/lib/limits";
import { hashPassword, verifyPassword } from "@/lib/auth/visitor-password";
import { isValidPassword } from "@/lib/page-accounts/input";
import { buildSessionCookie, MEMBER_SESSION_TTL_MS } from "@/lib/page-accounts/session";
import { resolveSignedIn } from "@/lib/page-accounts/signed-in";
import { createSession, deleteAccountSessions, findAccountForLogin, updateAccount } from "@/lib/page-accounts/store";
import { fromThisPage, json, pageSubOf, siteWithAccounts } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);

  const byIp = await checkAndConsume(ipLimitKey(getClientIp(req), "page_login"), IP_LIMITS.page_login);
  if (!byIp.ok) return json({ error: "rate_limited" }, 429);

  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  const signedIn = await resolveSignedIn(req.headers, site);
  if (!signedIn) return json({ error: "not_signed_in" }, 401);
  // El dueño no tiene contraseña aquí: entra con la de OpenLen.
  if (signedIn.actor.tipo !== "cuenta" || !signedIn.account) return json({ error: "owner_uses_openlen" }, 400);

  let body: { current?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
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
