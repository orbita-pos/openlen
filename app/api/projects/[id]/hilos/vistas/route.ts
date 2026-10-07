// POST /api/projects/[id]/hilos/vistas { hilos: [id] } — quien pide ya vio sus
// menciones en esos hilos (los tuvo delante en la lente «Código»).
import { z } from "zod";

import { marcarVistas } from "@/lib/projects/hilos";
import { json, quienEnElProyecto } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Cuerpo = z.object({ hilos: z.array(z.string().max(100)).max(500) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const body = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  await marcarVistas(id, q.userId, body.data.hilos);
  return json({ ok: true });
}
