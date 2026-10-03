// /api/a/accounts — las cuentas de la página, para el DUEÑO.
//
//   GET  → {"accounts": [{"id","email","name","role","createdAt","lastLoginAt"}]}
//   POST → crear una: {"email","password","name"?,"role"?} → 201 {"account"}
//
// Sólo el dueño, que entra en su página con su cuenta de OpenLen
// (`/api/a/owner-start`). Con `registro: "cerrado"` —el de una caja con
// sus cajeros— es la ÚNICA forma de que exista una cuenta.

import { hashPassword } from "@/lib/auth/visitor-password";
import { cleanName, isValidPassword, normalizeEmail, roleFromInput } from "@/lib/page-accounts/input";
import { resolveSignedIn } from "@/lib/page-accounts/signed-in";
import { createAccount, listAccounts } from "@/lib/page-accounts/store";
import { fromThisPage, json, pageSubOf, publicAccount, readFromThisPage, siteWithAccounts } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!readFromThisPage(req)) return json({ error: "bad_origin" }, 403);
  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  const signedIn = await resolveSignedIn(req.headers, site);
  if (signedIn?.actor.tipo !== "dueño") return json({ error: "owner_only" }, 403);

  const accounts = await listAccounts(site.projectId);
  return json(
    {
      accounts: accounts.map((a) => ({
        ...publicAccount(a),
        // El papel QUE VALE hoy: uno que la página ya no declara sale null.
        role: a.role !== null && site.accounts.papeles.includes(a.role) ? a.role : null,
        createdAt: a.createdAt,
        lastLoginAt: a.lastLoginAt,
      })),
    },
    200,
  );
}

export async function POST(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);
  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  const signedIn = await resolveSignedIn(req.headers, site);
  if (signedIn?.actor.tipo !== "dueño") return json({ error: "owner_only" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "invalid_email" }, 422);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidPassword(password)) return json({ error: "weak_password" }, 422);
  const role = roleFromInput(body.role, site.accounts);
  if (role === false) return json({ error: "unknown_role", roles: site.accounts.papeles }, 422);

  const created = await createAccount({
    projectId: site.projectId,
    email,
    name: cleanName(body.name),
    role: role ?? null,
    passwordHash: await hashPassword(password),
  });
  if (created === "exists") return json({ error: "email_taken" }, 409);
  return json({ account: publicAccount(created) }, 201);
}
