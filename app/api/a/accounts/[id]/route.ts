// /api/a/accounts/<id> — cambiar o quitar UNA cuenta, para el DUEÑO.
//
//   PATCH  {"role"?, "name"?, "password"?} → {"account"}
//   DELETE → {"ok": true}
//
// Una contraseña nueva cierra todas sus sesiones (si el dueño se la cambia es
// porque algo pasó); quitar la cuenta, también (`ON DELETE CASCADE`).

import { hashPassword } from "@/lib/auth/visitor-password";
import { cleanName, isValidPassword, roleFromInput } from "@/lib/page-accounts/input";
import { resolveSignedIn } from "@/lib/page-accounts/signed-in";
import { deleteAccount, deleteAccountSessions, updateAccount } from "@/lib/page-accounts/store";
import { fromThisPage, json, pageSubOf, publicAccount, siteWithAccounts } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function asOwner(req: Request) {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);
  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;
  const signedIn = await resolveSignedIn(req.headers, site);
  if (signedIn?.actor.tipo !== "dueño") return json({ error: "owner_only" }, 403);
  return site;
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const site = await asOwner(req);
  if (site instanceof Response) return site;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const patch: { role?: string | null; name?: string | null; passwordHash?: string } = {};
  const role = roleFromInput(body.role, site.accounts);
  if (role === false) return json({ error: "unknown_role", roles: site.accounts.papeles }, 422);
  if (role !== undefined) patch.role = role;
  if (body.name !== undefined) patch.name = cleanName(body.name);
  if (body.password !== undefined) {
    if (!isValidPassword(body.password)) return json({ error: "weak_password" }, 422);
    patch.passwordHash = await hashPassword(body.password);
  }
  if (Object.keys(patch).length === 0) return json({ error: "nothing_to_change" }, 422);

  const updated = await updateAccount(site.projectId, id, patch);
  if (!updated) return json({ error: "not_found" }, 404);
  if (patch.passwordHash) await deleteAccountSessions(site.projectId, id);
  return json({ account: publicAccount(updated) }, 200);
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const site = await asOwner(req);
  if (site instanceof Response) return site;
  const done = await deleteAccount(site.projectId, id);
  return json({ ok: done }, done ? 200 : 404);
}
