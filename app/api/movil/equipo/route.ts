// Puente exclusivo de la APK. Los manejadores y la UI de la web no cambian.
import { z } from "zod";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { llaveDeLaCabecera } from "@/lib/movil/secreto";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { exigirAcceso, puede } from "@/lib/projects/acceso";
import { getChatMessages } from "@/lib/projects/chat";
import { escribirMensajeDelEquipo, marcarChatVisto } from "@/lib/projects/chat-equipo";
import { MAX_TEXTO_DEL_HILO, personasDelProyecto, listarHilos, hiloDelProyecto, responderHilo, cambiarEstado, marcarVistas, mencionesValidas } from "@/lib/projects/hilos";
import { mencionesDe } from "@/lib/workspace-v2/menciones";
import { scheduleNotification } from "@/lib/notifications/dispatch";
import { avisarMenciones, pedirleALen } from "@/app/api/projects/[id]/hilos/_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const base = z.object({ projectId: id });
const mensaje = { texto: z.string().trim().min(1).max(MAX_TEXTO_DEL_HILO), menciones: z.array(id).max(20).default([]), idioma: z.string().max(8).optional() };
const Cuerpo = z.discriminatedUnion("accion", [
  base.extend({ accion: z.literal("mensaje"), ...mensaje }),
  base.extend({ accion: z.literal("respuesta"), hiloId: id, ...mensaje, len: z.boolean().default(false) }),
  base.extend({ accion: z.literal("estado"), hiloId: id, estado: z.enum(["abierto", "resuelto"]) }),
  base.extend({ accion: z.literal("vistas"), chat: z.boolean().default(false), hilos: z.array(id).max(500).default([]) }),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
async function usuarioMovil(req: Request) {
  if (!llaveDeLaCabecera(req.headers.get("authorization"))) return null;
  return usuarioDeLaPeticion(req);
}

export const GET = paraLaApp(async (req: Request) => {
  const userId = await usuarioMovil(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const project = id.safeParse(new URL(req.url).searchParams.get("project"));
  if (!project.success) return json({ error: "invalid_project" }, 400);
  const acceso = await exigirAcceso(project.data, userId, "ver");
  if (acceso instanceof Response) return acceso;
  const [personas, historial, hilos] = await Promise.all([
    personasDelProyecto(project.data), getChatMessages(project.data), listarHilos(project.data, userId),
  ]);
  return json({
    yo: userId, rol: acceso.rol, puedeLen: puede(acceso.rol, "editar"),
    personas: personas.map(({ userId, nombre, rol, avatar }) => ({ userId, nombre, rol, avatar })),
    mensajes: historial.filter(t => t.tipo === "persona").map(t => ({
      id: t.id, autorId: t.autorId ?? "", autor: t.autor ?? "", texto: t.userText,
      fecha: t.appliedAt ?? 0, fotos: (t.attachedImages ?? (t.attachedImage ? [t.attachedImage] : [])).map(f => ({ url: f.url, alt: f.alt ?? "" })),
    })), hilos,
  });
});

export const POST = paraLaApp(async (req: Request) => {
  const userId = await usuarioMovil(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const parsed = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const b = parsed.data;
  const acceso = await exigirAcceso(b.projectId, userId, "ver");
  if (acceso instanceof Response) return acceso;
  if (b.accion === "vistas") {
    if (b.chat) await marcarChatVisto(b.projectId, userId);
    if (b.hilos.length) await marcarVistas(b.projectId, userId, b.hilos);
    return json({ ok: true });
  }
  // La comprobación del hilo usa AMBOS ids incluso para editores/dueño.
  const hilo = b.accion === "mensaje" ? null : await hiloDelProyecto(b.projectId, b.hiloId);
  if (b.accion !== "mensaje" && !hilo) return json({ error: "not_found" }, 404);
  if (b.accion === "estado") {
    if (!puede(acceso.rol, "editar")) {
      const propios = await listarHilos(b.projectId, userId);
      if (!propios.some(h => h.id === b.hiloId && h.creadoPor === userId)) return json({ error: "solo_lectura" }, 403);
    }
    return await cambiarEstado(b.projectId, b.hiloId, b.estado) ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }
  const personas = await personasDelProyecto(b.projectId);
  const mencion = mencionesDe(b.texto, personas);
  const menciones = mencionesValidas(b.menciones.filter(x => mencion.personas.includes(x)), personas, userId);
  const quien = personas.find(p => p.userId === userId)?.nombre ?? "";
  if (b.accion === "mensaje") {
    if (mencion.len) return json({ error: "lleva_len" }, 400);
    if (!menciones.length) return json({ error: "sin_mencion" }, 400);
    const escrito = await escribirMensajeDelEquipo({ projectId: b.projectId, autorId: userId, texto: b.texto, menciones });
    for (const recipientUserId of escrito.mencionados) {
      await scheduleNotification({ type: "mencion", donde: "chat", projectId: b.projectId, recipientUserId, quien, preview: b.texto.slice(0, 200), idioma: b.idioma ?? null },
        `mencion-chat:${b.projectId}:${recipientUserId}`, { retrasoMs: 60_000 }).catch(() => {});
    }
    return json(escrito);
  }
  const llamarLen = b.len || mencion.len;
  if (llamarLen && !puede(acceso.rol, "editar")) return json({ error: "solo_lectura" }, 403);
  const escrito = await responderHilo({ projectId: b.projectId, hiloId: b.hiloId, autorId: userId, texto: b.texto, menciones });
  if (!escrito) return json({ error: "not_found" }, 404);
  await avisarMenciones({ projectId: b.projectId, mencionados: escrito.mencionados, quien, texto: b.texto, ruta: hilo!.ruta, linea: hilo!.linea, ...(b.idioma ? { idioma: b.idioma } : {}) });
  const filaId = llamarLen ? await pedirleALen({ req, projectId: b.projectId, userId, hiloId: b.hiloId, mensajeId: escrito.mensajeId, texto: b.texto, ...(b.idioma ? { idioma: b.idioma } : {}) }) : null;
  return json({ ...escrito, filaId });
});
export const OPTIONS = respuestaPrevia;
