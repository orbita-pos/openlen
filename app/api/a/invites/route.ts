// POST /api/a/invites — el DUEÑO invita a alguien a su página.
// Cuerpo: {"email","role"?,"name"?,"back"?,"lang"?}.
//
// Como `inviteUserByEmail` de Supabase: la cuenta nace invitada, con su papel y
// SIN contraseña, y le llega un enlace de UN uso y 7 días (`/api/a/verify`) que
// la devuelve a la página (`back`) con un permiso para elegir su contraseña
// (`#ol-auth=invite&ol-grant=…` → `/api/a/password` con `{grant, next}`).
//
// Sólo el dueño, con su sesión en su página (como `/api/a/accounts`), y con
// cualquier `registro`: invitar es cosa suya. Un correo con cuenta activa da
// 409 —el dueño ya ve sus cuentas, no hay nada que esconderle—; uno invitado
// que aún no aceptó recibe otro enlace, con el papel de esta vez.

import { cleanLang, cleanName, normalizeEmail, roleFromInput, safeBackPath } from "@/lib/page-accounts/input";
import { accountEmailAvailable, sendAccountEmail } from "@/lib/page-accounts/mail";
import { EMAIL_TOKEN_TTL_MS } from "@/lib/page-accounts/session";
import { resolveSignedIn } from "@/lib/page-accounts/signed-in";
import { createEmailToken, createInvitedAccount, findAccountForLogin, updateAccount } from "@/lib/page-accounts/store";
import { fromThisPage, json, pageHostOf, pageSubOf, publicAccount, siteWithAccounts, verifyLink } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);
  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  const signedIn = await resolveSignedIn(req.headers, site);
  if (signedIn?.actor.tipo !== "dueño") return json({ error: "owner_only" }, 403);
  if (!accountEmailAvailable()) return json({ error: "email_unavailable" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "invalid_email" }, 422);
  const role = roleFromInput(body.role, site.accounts);
  if (role === false) return json({ error: "unknown_role", roles: site.accounts.papeles }, 422);

  let account = await createInvitedAccount({
    projectId: site.projectId,
    email,
    name: cleanName(body.name),
    role: role ?? null,
  });
  let status = 201;
  if (account === "exists") {
    const existing = await findAccountForLogin(site.projectId, email);
    if (existing?.status !== "invited") return json({ error: "email_taken" }, 409);
    account = (role !== undefined ? await updateAccount(site.projectId, existing.id, { role }) : null) ?? existing;
    status = 200;
  }

  const token = await createEmailToken({
    projectId: site.projectId,
    email,
    purpose: "invite",
    backPath: safeBackPath(body.back),
    ttlMs: EMAIL_TOKEN_TTL_MS.invite,
  });
  try {
    await sendAccountEmail({
      to: email,
      kind: "invite",
      link: verifyLink(req, token),
      host: pageHostOf(req),
      lang: cleanLang(body.lang),
      role: account.role,
    });
  } catch (err) {
    // La cuenta queda invitada: volver a invitar le manda otro enlace.
    console.error("[page-accounts] el correo de invitación no salió", err);
    return json({ error: "email_failed", account: publicAccount(account) }, 502);
  }
  return json({ account: publicAccount(account), invite: "sent" }, status);
}
