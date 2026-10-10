// Los usuarios de la página (Authentication → Users de Supabase), para el
// panel del dueño (lib/backend/dashboard.ts).
//
//   GET  ?page=     → { users, total }
//   POST { email }  → { ok: true }   invita: crea el usuario y le manda el correo

import { inviteUser, listAuthUsers } from "@/lib/backend/dashboard";
import { environmentFromRequest, json, notReady, objectBody, ownedBackend } from "@/lib/backend/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id, environmentFromRequest(req));
  if (ob.kind !== "ready") return notReady(ob);
  const page = Number(new URL(req.url).searchParams.get("page") ?? 1) || 1;
  return json(await listAuthUsers(ob.project, page));
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id, environmentFromRequest(req));
  if (ob.kind !== "ready") return notReady(ob);
  const body = await objectBody(req);
  if (!body || typeof body.email !== "string") return json({ error: "email is required" }, 400);
  const r = await inviteUser(ob.project, body.email.trim());
  return "error" in r ? json(r, 400) : json(r);
}
