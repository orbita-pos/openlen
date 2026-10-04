// POST /api/a/register — registrarse en una página con `registro: "abierto"`.
// Cuerpo: {"email","password","name"?,"back"?,"lang"?}.
//
// Como Supabase con «confirmar el correo» encendido (Jesús, 04/10): la cuenta
// nace SIN CONFIRMAR y sin papel, y no puede entrar hasta abrir el enlace que
// le llega (`/api/a/verify`), que la activa y la deja dentro. El papel se lo da
// el dueño después. `back` es a dónde vuelve en la página al abrirlo, y `lang`
// el idioma del correo.
//
// Responde SIEMPRE lo mismo, `{ok:true, confirm:"sent"}`, exista o no la
// cuenta: decir «ese correo ya está» enseña qué correos tienen cuenta. A una
// SIN confirmar se le manda otro enlace y no se le cambia nada (GoTrue: «we
// can't be sure of their claimed identity»).

import { checkAndConsume, getClientIp, IP_LIMITS, ipLimitKey } from "@/lib/limits";
import { hashPassword } from "@/lib/auth/visitor-password";
import { cleanLang, cleanName, isValidPassword, normalizeEmail, safeBackPath } from "@/lib/page-accounts/input";
import { accountEmailAvailable, sendAccountEmail } from "@/lib/page-accounts/mail";
import { EMAIL_TOKEN_TTL_MS } from "@/lib/page-accounts/session";
import { createEmailToken, createUnconfirmedAccount, findAccountForLogin } from "@/lib/page-accounts/store";
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
  // `cerrado`: las cuentas las crea el dueño. `invitacion`: entra quien él
  // invita (`/api/a/invites`).
  if (site.accounts.registro !== "abierto") return json({ error: "signup_closed" }, 403);
  // Sin correo de verdad, una cuenta que nadie podrá confirmar: se dice.
  if (!accountEmailAvailable()) return json({ error: "email_unavailable" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "invalid_email" }, 400);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidPassword(password)) return json({ error: "weak_password" }, 422);

  const byEmail = await checkAndConsume(`page_email:${site.projectId}:${email}`, EMAIL_SEND_LIMIT);
  if (!byEmail.ok) return json({ error: "rate_limited" }, 429);

  const backPath = safeBackPath(body.back);
  const lang = cleanLang(body.lang);
  // El bcrypt se paga también cuando la cuenta ya existe: el tiempo de
  // respuesta tampoco puede decirlo.
  const created = await createUnconfirmedAccount({
    projectId: site.projectId,
    email,
    name: cleanName(body.name),
    passwordHash: await hashPassword(password),
  });
  const sendConfirm =
    created !== "exists" || (await findAccountForLogin(site.projectId, email))?.status === "unconfirmed";

  if (sendConfirm) {
    const token = await createEmailToken({
      projectId: site.projectId,
      email,
      purpose: "confirm",
      backPath,
      ttlMs: EMAIL_TOKEN_TTL_MS.confirm,
    });
    // Sin esperar al envío: esperarlo haría más lenta la respuesta SÓLO cuando
    // se manda, y eso también diría si la cuenta existía.
    void sendAccountEmail({ to: email, kind: "confirm", link: verifyLink(req, token), host: pageHostOf(req), lang })
      .catch((err) => console.error("[page-accounts] el correo de confirmar no salió", err));
  }
  return json({ ok: true, confirm: "sent" }, 200);
}
