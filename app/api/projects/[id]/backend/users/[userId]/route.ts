// Un usuario de la página, para el panel del dueño (lib/backend/dashboard.ts).
//
//   DELETE                  → { ok: true }   lo borra (y con él sus sesiones)
//   DELETE ?only=sessions   → { ok: true }   cierra todas sus sesiones

import { deleteAuthUser, signOutUser } from "@/lib/backend/dashboard";
import { environmentFromRequest, json, notReady, ownedBackend } from "@/lib/backend/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }): Promise<Response> {
  const { id, userId } = await ctx.params;
  const ob = await ownedBackend(id, environmentFromRequest(req));
  if (ob.kind !== "ready") return notReady(ob);
  if (!UUID.test(userId)) return json({ error: "not_found" }, 404);
  if (new URL(req.url).searchParams.get("only") === "sessions") return json(await signOutUser(ob.project, userId));
  const r = await deleteAuthUser(ob.project, userId);
  return "error" in r ? json(r, 400) : json(r);
}
