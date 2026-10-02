// Los comandos de la terminal de Len en turnos anteriores, para la lente
// «Terminal» del lienzo (F6a de plans/len-agente-2026). El GET, sólo lectura.
//
// No hay tabla de comandos: cada `bash` ya vive en la transcripción del turno
// (`projectChatMessages.transcript`, la escribe sólo el servidor) y aquí se
// emparejan llamada y salida (`comandosDeLaTranscripcion`). Los del turno que
// está corriendo no salen de aquí: llegan en vivo por el evento `terminal` del
// stream de /api/agent.
//
// 401 sin sesión, 404 si el proyecto no es tuyo — el mismo par que las demás
// rutas de proyecto (ver la cabecera de `datos/route.ts`).
//
// Y POST, la terminal DEL USUARIO (abajo).

import { and, desc, eq, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { terminalEncendida } from "@/lib/agent/terminal/declaracion";
import { comandosDeLaTranscripcion } from "@/lib/agent/terminal/historial";
import { ejecutarEnLaTerminalDelUsuario } from "@/lib/agent/terminal/terminal-del-usuario";

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

/** Un comando más largo que esto no es algo que alguien teclee. */
const MAX_COMANDO = 16_000;

/**
 * POST — un comando en la terminal DEL USUARIO (la #17 de
 * plans/len-agente-2026/notas/fase-5-taller.md), aparte de la de Len: ni el
 * comando ni lo que imprime le llegan al modelo ni se guardan en la
 * conversación. Lo que escribe en los ficheros, sí, por el camino de `Write`
 * (con versión y sin poder meter código nuevo: `terminal-del-usuario.ts`).
 *
 *   { command } → { command, salida, exitCode, cambio }
 *
 * 401 sin sesión, 404 si el proyecto no es tuyo, 409 con la terminal apagada
 * en este servidor, 400 sin comando, 413 si es enorme.
 */
export async function POST(
  req: Request,
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
  if (!terminalEncendida()) return json({ error: "apagada" }, 409);

  let cuerpo: { command?: unknown };
  try {
    cuerpo = (await req.json()) as { command?: unknown };
  } catch {
    return json({ error: "sin_comando" }, 400);
  }
  const command = typeof cuerpo.command === "string" ? cuerpo.command : "";
  if (!command.trim()) return json({ error: "sin_comando" }, 400);
  if (command.length > MAX_COMANDO) return json({ error: "demasiado_largo" }, 413);

  return json(await ejecutarEnLaTerminalDelUsuario(id, userId, command));
}
