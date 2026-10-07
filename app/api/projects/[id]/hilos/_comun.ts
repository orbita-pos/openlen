// Lo común a las rutas de los hilos en el código (lib/projects/hilos.ts).
import { z } from "zod";

import { auth } from "@/auth";
import { accesoAlProyecto, type AccesoAlProyecto } from "@/lib/projects/acceso";
import { MAX_TEXTO_DEL_HILO } from "@/lib/projects/hilos";
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
  /** ¿Menciona a Len? Sólo quien puede editar (el turno lo lanza el cliente). */
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
