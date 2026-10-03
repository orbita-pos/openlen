// POST /api/a/login — entrar en la página con correo y contraseña.
// Cuerpo: {"email": "...", "password": "..."}. Pone la cookie de sesión.

import { checkAndConsume, getClientIp, IP_LIMITS, ipLimitKey } from "@/lib/limits";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/visitor-password";
import { actorFromSession } from "@/lib/page-accounts/actor";
import { isValidPassword, normalizeEmail } from "@/lib/page-accounts/input";
import { buildSessionCookie, MEMBER_SESSION_TTL_MS, readSessionCookie } from "@/lib/page-accounts/session";
import { createSession, deleteSession, findAccountForLogin, markLogin } from "@/lib/page-accounts/store";
import { fromThisPage, json, pageSubOf, publicAccount, siteWithAccounts } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fallos por cuenta antes de bloquearla un rato. Por IP hay otro tope
 *  (`IP_LIMITS.page_login`): uno frena a quien prueba muchas cuentas, éste a
 *  quien prueba muchas contraseñas contra una desde muchas IPs. */
const ACCOUNT_LIMIT = [{ windowMs: 15 * 60 * 1000, max: 10, label: "15-minute" }];

export async function POST(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);

  const byIp = await checkAndConsume(ipLimitKey(getClientIp(req), "page_login"), IP_LIMITS.page_login);
  if (!byIp.ok) return json({ error: "rate_limited" }, 429);

  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  // El MISMO error para todo lo que sale mal: decir «ese correo no existe»
  // enseña qué correos tienen cuenta.
  if (!email || !isValidPassword(password)) return json({ error: "invalid_credentials" }, 401);

  const byAccount = await checkAndConsume(`page_login:${site.projectId}:${email}`, ACCOUNT_LIMIT);
  if (!byAccount.ok) return json({ error: "rate_limited" }, 429);

  const account = await findAccountForLogin(site.projectId, email);
  // Siempre se paga un bcrypt entero, exista o no: el tiempo de respuesta
  // tampoco puede decir si la cuenta existe.
  const passwordOk = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || account.status !== "active" || !account.passwordHash || !passwordOk) {
    return json({ error: "invalid_credentials" }, 401);
  }

  // Una sesión anterior en este navegador se cierra: entrar siempre estrena.
  const previous = readSessionCookie(req.headers);
  if (previous) await deleteSession(previous);

  const token = await createSession({ projectId: site.projectId, memberId: account.id, ttlMs: MEMBER_SESSION_TTL_MS });
  await markLogin(account.id);
  const actor = actorFromSession({
    accounts: site.accounts,
    session: { memberId: account.id, ownerUserId: null },
    projectOwnerId: site.ownerUserId,
    account,
  });
  return json({ account: publicAccount(account, actor ?? undefined), owner: false }, 200, [
    buildSessionCookie(token, MEMBER_SESSION_TTL_MS),
  ]);
}
