// /api/projects/[id]/chat/mensajes — EL CHAT DEL EQUIPO (lib/projects/chat-equipo.ts).
//
// POST { texto, menciones, idioma? } → { id, mencionados }: un mensaje para
//   personas del proyecto; Len no contesta. Cualquier rol (un lector también:
//   escribir a alguien es comentar, no editar). Con `@Len` es un turno y va por
//   /api/agent (400 lleva_len).
// GET ?solo=sinVer → { sinVer }: las menciones del chat sin ver de quien pide.
// GET ?solo=firma → { firma }: la firma de la conversación (`firmaDelChat`), para
//   que un chat compartido abierto la relea sólo si cambió.
import { z } from "zod";

import { MAX_TEXTO_DEL_HILO, mencionesValidas, personasDelProyecto } from "@/lib/projects/hilos";
import { escribirMensajeDelEquipo, firmaDelChat, mencionesDelChatSinVer } from "@/lib/projects/chat-equipo";
import { scheduleNotification } from "@/lib/notifications/dispatch";
import { mencionesDe } from "@/lib/workspace-v2/menciones";
import { json, quienEnElProyecto } from "../../hilos/_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const Cuerpo = z.object({
  texto: z.string().trim().min(1).max(MAX_TEXTO_DEL_HILO),
  menciones: z.array(z.string().max(100)).max(20).default([]),
  idioma: z.string().max(8).optional(),
});

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const solo = new URL(req.url).searchParams.get("solo");
  if (solo === "sinVer") return json({ sinVer: await mencionesDelChatSinVer(id, q.userId) });
  if (solo === "firma") return json({ firma: await firmaDelChat(id) });
  return json({ error: "invalid_query" }, 400);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const q = await quienEnElProyecto(id);
  if (!q.ok) return q.respuesta;
  const body = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  const personas = await personasDelProyecto(id);
  if (mencionesDe(body.data.texto, personas).len) {
    return json({ error: "lleva_len", message: "Messages to Len are turns: send them to /api/agent." }, 400);
  }
  if (mencionesValidas(body.data.menciones, personas, q.userId).length === 0) return json({ error: "sin_mencion" }, 400);
  const escrito = await escribirMensajeDelEquipo({ projectId: id, autorId: q.userId, texto: body.data.texto, menciones: body.data.menciones });
  for (const recipientUserId of escrito.mencionados) {
    await scheduleNotification({
      type: "mencion",
      donde: "chat",
      projectId: id,
      recipientUserId,
      quien: q.nombre,
      preview: body.data.texto.slice(0, 200),
      idioma: body.data.idioma ?? null,
    },
    // Como Slack: el aviso espera un minuto (si lo ve antes, no sale) y las
    // menciones seguidas a la misma persona se juntan en UN aviso.
    `mencion-chat:${id}:${recipientUserId}`,
    { retrasoMs: 60_000 },
    ).catch((err) => console.error("[chat-equipo] no se pudo programar el aviso de mención", err));
  }
  return json({ id: escrito.id, mencionados: escrito.mencionados });
}
