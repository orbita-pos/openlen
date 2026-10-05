// Contestar a una pregunta de Len mientras el turno la espera (pieza 3 de Len
// 2.5: `ask_user_question` espera la respuesta DENTRO del turno, como DeepSeek).
//
// POR QUÉ OTRA RUTA, como `/dirigir`: el SSE de `/api/agent` va en una sola
// dirección. La respuesta entra por aquí y se encuentra con la herramienta que
// espera a través del almacén en proceso (`lib/agent/direcciones.ts`).
//
// AUTORIZACIÓN, la de `/dirigir`: sesión + dueño DEL TURNO. 401 sin sesión ·
// 404 si el turno no existe O no es tuyo (lo mismo, para no confirmar ids) ·
// 409 con su código si nadie espera (`sin_pregunta`: el chat la manda como
// mensaje normal y abre el turno siguiente) o ya se contestó (`ya_respondida`:
// el chat no hace nada) · 400 si la respuesta no tiene la forma de DeepSeek.

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { responder } from "@/lib/agent/direcciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "no_autenticado" }, 401);

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "cuerpo_invalido" }, 400);
  }

  const { turnoId, answers } = (cuerpo ?? {}) as { turnoId?: unknown; answers?: unknown };
  if (typeof turnoId !== "string" || !turnoId) return json({ error: "falta_turno" }, 400);

  const r = responder(turnoId, userId, answers);
  if (r === "ok") return json({ ok: true });
  if (r === "invalida") return json({ error: "respuesta_invalida" }, 400);
  if (r === "sin_pregunta" || r === "ya_respondida") return json({ error: r }, 409);
  return json({ error: "turno_no_encontrado" }, 404);
});

export const OPTIONS = respuestaPrevia;
