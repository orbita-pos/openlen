// Los comandos de la terminal de Len en turnos anteriores, para la lente
// «Terminal» del lienzo (F6a de plans/len-agente-2026). SÓLO LECTURA.
//
// No hay tabla de comandos: cada `bash` ya vive en la transcripción del turno
// (`projectChatMessages.transcript`, la escribe sólo el servidor) y aquí se
// emparejan llamada y salida (`comandosDeLaTranscripcion`). Los del turno que
// está corriendo no salen de aquí: llegan en vivo por el evento `terminal` del
// stream de /api/agent.
//
// 401 sin sesión, 404 si el proyecto no es tuyo — el mismo par que las demás
// rutas de proyecto (ver la cabecera de `datos/route.ts`).

import { and, desc, eq, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { terminalEncendida } from "@/lib/agent/terminal/declaracion";
import { comandosDeLaTranscripcion } from "@/lib/agent/terminal/historial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuántos turnos con terminal se devuelven, del más reciente hacia atrás. */
const TURNOS = 20;

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const propio = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  if (propio.length === 0) return json({ error: "not_found" }, 404);

  const t = schema.projectChatMessages;
  // El filtro de texto es sólo para no traer de la base las transcripciones
  // sin terminal (pueden pesar cientos de KB cada una); quien decide qué es un
  // comando es `comandosDeLaTranscripcion`.
  const filas = await db
    .select({ id: t.id, userText: t.userText, createdAt: t.createdAt, transcript: t.transcript })
    .from(t)
    .where(and(eq(t.projectId, id), sql`${t.transcript}::text like '%"bash"%'`))
    .orderBy(desc(t.createdAt))
    .limit(TURNOS);

  const turnos = filas
    .reverse()
    .map((f) => ({
      id: f.id,
      pedido: f.userText.slice(0, 200),
      creado: f.createdAt.toISOString(),
      comandos: comandosDeLaTranscripcion(f.transcript?.mensajes ?? []),
    }))
    .filter((turno) => turno.comandos.length > 0);

  return json({ encendida: terminalEncendida(), turnos });
}
