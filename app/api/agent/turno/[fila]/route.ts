// Volver a mirar un turno que sigue trabajando.
//
// LEN 2.1 · EL REENGANCHE (diagnóstico §4.4 punto 3). El turno ya no muere con
// el cliente y su fila se guarda a medida que pasa (`status: en_curso`). Esta
// ruta la devuelve: el panel la relee cada pocos segundos mientras el turno
// sigue —tras perder la red, desde otra pestaña, desde el móvil— hasta que
// cierra. Decisión de Jesús (30/09): releer la fila, sin un stream que
// reenganchar.
//
// Devuelve el turno tal y como lo guarda la conversación (`StoredChatTurn`) y,
// si sigue vivo, su `turnoId`: con él se corrige (`dirigir`) o se para
// (`cancelar`), igual que desde el stream.
//
// 🔴 UNA FILA EN CURSO QUE NADIE CORRE SE CIERRA AQUÍ. Si el servidor se
// reinició a mitad de un turno (un deploy), su `finally` no llegó y la fila se
// quedaría «trabajando» para siempre. Con un solo proceso, el almacén de turnos
// es la verdad (`turnoDeLaFila`): si no lo tiene, el turno murió, y la fila
// pasa a cortada. ⚠️ Con dos instancias dejaría de ser cierto, igual que
// `dirigir`.
//
// AUTORIZACIÓN: sesión + dueño del proyecto de la fila. 404 si no existe o no
// es tuya, sin distinguir.

import { auth } from "@/auth";
import { turnoDeLaFila } from "@/lib/agent/direcciones";
import { leerTurnoDelUsuario, marcarCortadaSiSigueEnCurso } from "@/lib/projects/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fila: string }> },
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "no_autenticado" }, 401);

  const { fila } = await params;
  if (!fila) return json({ error: "falta_fila" }, 400);

  const turno = await leerTurnoDelUsuario(fila, userId);
  if (!turno) return json({ error: "turno_no_encontrado" }, 404);

  if (!turno.enCurso) return json({ turno });

  const turnoId = turnoDeLaFila(fila, userId);
  if (turnoId) return json({ turno, turnoId });

  // Huérfana: nadie la corre. Se cierra como cortada, y se dice ya así.
  try {
    await marcarCortadaSiSigueEnCurso(fila);
  } catch (err) {
    console.warn("[agent/turno] no se pudo cerrar la fila huérfana", err);
  }
  const { enCurso: _sigue, ...resto } = turno;
  return json({ turno: { ...resto, cortado: true } });
}
