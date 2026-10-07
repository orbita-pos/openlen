// Lo común a las rutas de los hilos en el código (lib/projects/hilos.ts).
import { z } from "zod";

import { auth } from "@/auth";
import { accesoAlProyecto, type AccesoAlProyecto } from "@/lib/projects/acceso";
import { MAX_TEXTO_DEL_HILO, apuntarPedidoALen, contextoParaLen, listarHilos } from "@/lib/projects/hilos";
import { fraseDeFalloDelHilo, idiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";
import { lanzarTurnoDelHilo } from "@/lib/agent/turnos-desde-el-servidor";

async function listarHilosPorId(projectId: string, userId: string, hiloId: string) {
  return (await listarHilos(projectId, userId)).filter((h) => h.id === hiloId);
}
import { scheduleNotification } from "@/lib/notifications/dispatch";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type Quien =
  | { readonly ok: false; readonly respuesta: Response }
  | { readonly ok: true; readonly userId: string; readonly nombre: string; readonly acceso: AccesoAlProyecto };

/** Quien pide y su acceso al proyecto: comentar es VER (un lector también comenta). */
export async function quienEnElProyecto(projectId: string): Promise<Quien> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, respuesta: json({ error: "unauthorized" }, 401) };
  const acceso = await accesoAlProyecto(projectId, userId);
  if (!acceso) return { ok: false, respuesta: json({ error: "not_found" }, 404) };
  return { ok: true, userId, nombre: session.user?.name?.trim() || session.user?.email || "", acceso };
}

export const CuerpoDelMensaje = z.object({
  texto: z.string().trim().min(1).max(MAX_TEXTO_DEL_HILO),
  /** Ids de las personas mencionadas (las valida `mencionesValidas`). */
  menciones: z.array(z.string().max(100)).max(20).default([]),
  /** ¿Menciona a Len? Sólo quien puede editar (el turno arranca en el servidor). */
  len: z.boolean().default(false),
  /** El idioma de la interfaz de quien escribe: el del correo del aviso. */
  idioma: z.string().max(8).optional(),
});

/** Un aviso a cada mencionado. Fail-soft: el hilo ya está escrito. */
export async function avisarMenciones(p: {
  projectId: string;
  mencionados: readonly string[];
  quien: string;
  texto: string;
  ruta: string;
  linea: number;
  idioma?: string;
}): Promise<void> {
  for (const recipientUserId of p.mencionados) {
    await scheduleNotification({
      type: "mencion",
      projectId: p.projectId,
      recipientUserId,
      quien: p.quien,
      preview: p.texto.slice(0, 200),
      ruta: p.ruta,
      linea: p.linea,
      idioma: p.idioma ?? null,
    }).catch((err) => console.error("[hilos] no se pudo programar el aviso de mención", err));
  }
}

/**
 * `@Len` en un hilo: el turno arranca EN EL SERVIDOR (como Claude Tag), con lo
 * dicho antes en el hilo como contexto SÓLO para el modelo. El pedido se apunta
 * en el mensaje ANTES de lanzarlo: si el servidor se reinicia antes de que Len
 * conteste, se retoma al arrancar (`retomarPedidosDelHilo`). Devuelve su fila,
 * para que el chat lo siga si está abierto.
 */
export async function pedirleALen(p: {
  req: Request;
  projectId: string;
  userId: string;
  hiloId: string;
  mensajeId: string;
  texto: string;
  idioma?: string;
}): Promise<string | null> {
  const [hilo] = await listarHilosPorId(p.projectId, p.userId, p.hiloId);
  if (!hilo) return null;
  const idioma = idiomaDelCorreo(p.idioma);
  const filaId = crypto.randomUUID();
  await apuntarPedidoALen({ mensajeId: p.mensajeId, filaId, pedido: { idioma, url: p.req.url } });
  await lanzarTurnoDelHilo({
    userId: p.userId,
    projectId: p.projectId,
    texto: p.texto,
    filaId,
    hilo: { hiloId: hilo.id, ruta: hilo.ruta, linea: hilo.linea, contexto: contextoParaLen(hilo, p.mensajeId) },
    origen: p.req.url,
    fraseDeFallo: (fallo) => fraseDeFalloDelHilo(idioma, fallo),
  });
  return filaId;
}
