// Parar al Agente a propósito.
//
// POR QUÉ ES OTRA RUTA. Hasta Len 2.1 parar era cerrar la conexión: el
// `cancel()` del stream de `/api/agent` abortaba el modelo. Eso también mataba
// el turno cuando se cerraba la pestaña, se caía la red o se dormía el móvil,
// y es lo que impedía que Len trabajara sin nadie mirando (diagnóstico de 2.1,
// §3.1 y §4.4 punto 1). Ahora la conexión es sólo la vista: el turno sigue sin
// ella, y pararlo es una decisión que se pide aquí, como la corrección de
// rumbo (`dirigir`).
//
// AUTORIZACIÓN: sesión + dueño DEL TURNO, la misma pareja que `dirigir`. 404 si
// el turno no existe O no es tuyo, para no confirmar a un extraño qué ids
// existen. La comprobación vive en el almacén (`lib/agent/direcciones.ts`).

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { cancelar } from "@/lib/agent/direcciones";

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

  const { turnoId } = (cuerpo ?? {}) as { turnoId?: unknown };
  if (typeof turnoId !== "string" || !turnoId) return json({ error: "falta_turno" }, 400);

  // `ajeno` y `no_existe` responden LO MISMO a propósito, como en `dirigir`.
  if (cancelar(turnoId, userId) !== "ok") return json({ error: "turno_no_encontrado" }, 404);

  // El bucle se entera en su siguiente llamada al modelo: el stream abortado
  // cierra con `cancelled` y el turno termina como un ■ de siempre (0 créditos,
  // y la fila como cortada si ya había cambiado algo).
  return json({ ok: true });
});

export const OPTIONS = respuestaPrevia;
