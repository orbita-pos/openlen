// Quien abre el chat ya vio sus menciones en él (el punto del carril se apaga).
import { marcarChatVisto } from "@/lib/projects/chat-equipo";
import { json, quienEnElProyecto } from "../../../hilos/_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  await marcarChatVisto(id, q.userId);
  return json({ ok: true });
}
