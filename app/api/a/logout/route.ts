// POST /api/a/logout — salir. Borra la sesión de la base y la cookie.

import { clearSessionCookie, readSessionCookie } from "@/lib/page-accounts/session";
import { deleteSession } from "@/lib/page-accounts/store";
import { fromThisPage, json, pageSubOf } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return json({ error: "not_a_page" }, 404);
  // También aquí: sacar al cajero de su caja desde una página hermana es un
  // ataque pequeño, pero es un ataque.
  if (!(await fromThisPage(req, sub))) return json({ error: "bad_origin" }, 403);

  const token = readSessionCookie(req.headers);
  if (token) await deleteSession(token);
  return json({ ok: true }, 200, [clearSessionCookie()]);
}
