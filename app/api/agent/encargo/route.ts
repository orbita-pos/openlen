// POST /api/agent/encargo — QUITAR EL ENCARGO (pieza 8 de Len 2.5).
//
// El control del dueño que no es un turno, como `/goal clear` de DeepSeek
// (`packages/goal/command-goal`): borra el encargo de la charla en curso y lo
// desarma en el proceso. Crearlo («Encargo» en el «+») y reanudarlo
// («Reanudar») sí son turnos —el primero es la ronda 1 y el segundo la
// siguiente—, así que van por `POST /api/agent` con `goal`.
//
// 🔴 NUNCA CON UNA RONDA VIVA en el proyecto: al cerrar escribiría su foto y el
// encargo volvería. Para eso está el ■, que lo deja en pausa.
//
// AUTORIZACIÓN: sesión + dueño del proyecto. 404 si no es tuyo, sin distinguir.

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { turnoVivoDelProyecto } from "@/lib/agent/direcciones";
import { disarmGoal } from "@/lib/agent/goal-activation";
import { quitarEncargo } from "@/lib/projects/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "no_autenticado" }, 401);

  const cuerpo = (await req.json().catch(() => null)) as { projectId?: unknown; action?: unknown } | null;
  const projectId = typeof cuerpo?.projectId === "string" ? cuerpo.projectId.trim() : "";
  if (!projectId || cuerpo?.action !== "clear") return json({ error: "cuerpo_invalido" }, 400);

  if (turnoVivoDelProyecto(projectId, userId)) return json({ error: "turno_en_curso" }, 409);

  if ((await quitarEncargo(projectId, userId)) !== "ok") return json({ error: "proyecto_no_encontrado" }, 404);
  disarmGoal(projectId);
  return json({ ok: true });
});

export const OPTIONS = respuestaPrevia;
