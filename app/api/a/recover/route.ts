// POST /api/a/recover — «olvidé mi contraseña». Cuerpo: {"email","back"?,"lang"?}.
//
// Si la cuenta existe, le llega un enlace de UN uso y una hora
// (`/api/a/verify`) que la devuelve a la página con un permiso para poner una
// contraseña nueva SIN la vieja (`/api/a/password` con `{grant, next}`).
// Responde SIEMPRE `{ok:true}`: decir «ese correo no tiene cuenta» enseña cuáles
// la tienen. Vale con cualquier `registro`: una cajera que dio de alta el dueño
// también olvida su contraseña.

import { checkAndConsume, getClientIp, IP_LIMITS, ipLimitKey } from "@/lib/limits";
import { cleanLang, normalizeEmail, safeBackPath } from "@/lib/page-accounts/input";
import { accountEmailAvailable, sendAccountEmail } from "@/lib/page-accounts/mail";
import { EMAIL_TOKEN_TTL_MS } from "@/lib/page-accounts/session";
import { createEmailToken, findAccountForLogin } from "@/lib/page-accounts/store";
import { EMAIL_SEND_LIMIT, fromThisPage, json, pageHostOf, pageSubOf, siteWithAccounts, verifyLink } from "../_shared";

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
  if (!accountEmailAvailable()) return json({ error: "email_unavailable" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "invalid_email" }, 400);

  // Por correo, ANTES de mirar si existe: el 429 sale igual para todos.
  const byEmail = await checkAndConsume(`page_email:${site.projectId}:${email}`, EMAIL_SEND_LIMIT);
  if (!byEmail.ok) return json({ error: "rate_limited" }, 429);

  const account = await findAccountForLogin(site.projectId, email);
  if (account) {
    const token = await createEmailToken({
      projectId: site.projectId,
      email,
      purpose: "recovery",
      backPath: safeBackPath(body.back),
      ttlMs: EMAIL_TOKEN_TTL_MS.recovery,
    });
    // Sin esperar al envío, como en `register`: su tiempo diría que existe.
    void sendAccountEmail({ to: email, kind: "recovery", link: verifyLink(req, token), host: pageHostOf(req), lang: cleanLang(body.lang) })
      .catch((err) => console.error("[page-accounts] el correo de recuperar no salió", err));
  }
  return json({ ok: true }, 200);
}
