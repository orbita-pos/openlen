// GET /api/a/me — quién soy en esta página.
//
//   {"account": {"id","email","name","role"} | null, "owner": true|false}
//
// Con `owner: true` es el dueño del proyecto, que entró con su cuenta de
// OpenLen (`/api/a/owner-start`): lo puede todo y no es una cuenta.

import { resolveSignedIn } from "@/lib/page-accounts/signed-in";
import { json, pageSubOf, publicAccount, readFromThisPage, siteWithAccounts } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  if (!readFromThisPage(req)) return json({ error: "bad_origin" }, 403);

  const site = await siteWithAccounts(sub);
  if (site instanceof Response) return site;

  const signedIn = await resolveSignedIn(req.headers, site);
  if (!signedIn) return json({ account: null, owner: false }, 200);
  if (signedIn.actor.tipo === "dueño") return json({ account: null, owner: true }, 200);
  return json({ account: publicAccount(signedIn.account!, signedIn.actor), owner: false }, 200);
}
