import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  appendChatMessage,
  updateChatMessageStatus,
} from "@/lib/projects/chat";

// ─────────────────────────────────────────────────────────────────────────────
// Chat transcript — append-only log endpoints.
//
// POST appends one settled turn; PATCH flips a turn's status (Undo). Reads go
// through GET /api/projects/[id] (getProject bundles the transcript). The
// append-only model is what makes the same project safe in two browser tabs:
// concurrent POSTs interleave, never clobber.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// F2-T11: agent-mode tool card, final states only. Optional on TurnSchema —
// old clients/rows never send this, so omission must validate identically to
// today (backward compat is the point of this schema).
const ActionSchema = z.object({
  tool: z.string().min(1).max(40),
  // `warning` desde el 2026-09-04 (ver `agent-action-card.tsx`). Sin añadirlo
  // aquí, una tarjeta con ese estado hace 400 a TODO el turno y el turno
  // desaparece al recargar, en silencio — el modo de fallo que el comentario de
  // abajo describe para el `summary` largo.
  status: z.enum(["running", "done", "warning", "error"]),
  // Truncate, don't reject: a model-written summary that runs long must not
  // 400 the whole turn (which vanishes silently on reload). `tool` stays a
  // hard structural reject; the actions count truncates too (see TurnSchema).
  summary: z.string().transform((s) => s.slice(0, 200)),
  /** POR QUÉ falló, literal — el mismo string que leyó el modelo. Se TRUNCA, no
   *  se rechaza, por el mismo motivo que el `summary`: un motivo largo haría
   *  400 a todo el turno y el turno desaparecería al recargar, en silencio.
   *  Ver `lib/agent/motivo-del-fallo.ts`. */
  motivo: z
    .string()
    .transform((s) => s.slice(0, 200))
    .optional(),
  /** Cuántas ediciones aplicó esta llamada. */
  edits: z.number().int().min(0).max(10_000).optional(),
  /** Los valores que aplicó la llamada, para el historial (H08-b). Se TRUNCA,
   *  no se rechaza, como el `summary`. Y tiene que estar AQUÍ: `z.object`
   *  descarta en silencio lo que no nombra, así que sin esta línea el campo
   *  llegaría y se perdería al guardar. */
  valores: z
    .string()
    .transform((s) => s.slice(0, 200))
    .optional(),
  /**
   * LO QUE VIERON LOS OJOS, y CUÁNTAS páginas miraron de las que tocó el turno.
   *
   * 🔴 Tienen que estar AQUÍ por lo mismo que `valores`: el servidor escribe
   * la fila primero y CON ellos (`registrarTurnoDelServidor`), pero el guardado
   * del navegador llega después y reescribe `actions` entero con lo que deja
   * pasar este esquema. Sin estas líneas se veían en vivo y desaparecían al
   * recargar, justo lo que los comentarios de `AgentAction` dan por arreglado.
   *
   * La observación se TRUNCA, no se rechaza, como el `motivo`; el tope es más
   * largo porque junta hasta cuatro frases del modelo con visión, y a 200 se
   * cortaría una observación normal.
   */
  observacion: z
    .string()
    .transform((s) => s.slice(0, 1000))
    .optional(),
  paginasMiradas: z.number().int().min(0).max(1000).optional(),
  paginasTocadas: z.number().int().min(0).max(1000).optional(),
  /**
   * QUÉ cambió, resuelto por el servidor mientras los `data-op-id` valían.
   *
   * 🔴 VA EN LA ACCIÓN Y NO EN EL TURNO porque `actions` es la única parte del
   * turno que se guarda como JSON: `appendChatMessage` escribe COLUMNAS
   * explícitas, así que un campo nuevo a nivel de turno se pierde sin decir
   * nada. Se pintaba en vivo y desaparecía al recargar — cazado probándolo en
   * el navegador, no por los tipos.
   */
  ops: z
    .array(
      z.object({
        tipo: z.enum(["replace", "insert_before", "insert_after", "delete", "attrs", "text"]),
        donde: z.enum(["documento", "estilos", "cabecera", "comportamiento"]),
        // Recortar, no rechazar: una etiqueta larga no puede tirar el turno.
        etiqueta: z.string().transform((v) => v.slice(0, 120)),
        indice: z.number().int().min(-1).max(10_000),
      }),
    )
    .max(24)
    .optional(),
})
  // El recuento va los dos juntos o ninguno: la tarjeta sólo lo pinta con los
  // dos. Uno suelto se DESCARTA en vez de tirar el turno entero con un 400.
  .transform(({ paginasMiradas, paginasTocadas, ...resto }) =>
    paginasMiradas !== undefined && paginasTocadas !== undefined
      ? { ...resto, paginasMiradas, paginasTocadas }
      : resto,
  );

/** Tarjetas que se guardan por turno. Por encima de lo que el bucle produce
 *  (26 llamadas como mucho, más las de los ojos): recortar aquí es una red, no
 *  algo que un turno normal toque. */
const MAX_TARJETAS_GUARDADAS = 40;

const TurnSchema = z.object({
  id: z.string().min(1).max(100),
  userText: z.string().min(1).max(4000),
  attachedImage: z
    .object({
      url: z.string().max(2000),
      alt: z.string().max(1000).optional(),
    })
    .optional(),
  assistantReasoning: z.string().max(20000),
  status: z.enum(["applied", "reverted"]),
  page: z.string().max(200).nullable().optional(),
  // F2-T11: both optional/backward-compatible — see ActionSchema comment.
  // Confirm cards are deliberately never part of this shape (never sent by
  // the panel) — see chat-panel.tsx's persistTurn comment for why.
  //
  // 🔴 SE RECORTA, NO SE RECHAZA. Esto era `.max(12)`, y el bucle deja hacer
  // hasta 26 llamadas por turno: un turno de 14 tarjetas respondía 400 y el
  // navegador no guardaba NADA (comprobado en el navegador el 2026-09-22; en
  // producción, 2 de los 22 turnos con tarjetas de los 14 días anteriores
  // pasaban de 12). Por encima de lo que el bucle puede producir se recorta,
  // como el `summary`; sólo lo que no puede venir de un turno se rechaza.
  actions: z
    .array(ActionSchema)
    .max(200)
    .transform((a) => a.slice(0, MAX_TARJETAS_GUARDADAS))
    .optional(),
  noDocChange: z.boolean().optional(),
});

const StatusSchema = z.object({
  turnId: z.string().min(1).max(100),
  status: z.enum(["applied", "reverted"]),
});

async function ownsProject(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// POST /api/projects/[id]/chat — append one settled turn to the transcript.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await ownsProject(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }
  const parsed = TurnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "invalid" }, 400);
  }
  try {
    await appendChatMessage(id, parsed.data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/chat] append failed", err);
    return json({ error: "db_error" }, 500);
  }
  return json({ ok: true }, 200);
}

// PATCH /api/projects/[id]/chat — flip a turn's status (Undo → reverted).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await ownsProject(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }
  const parsed = StatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "invalid" }, 400);
  }
  try {
    await updateChatMessageStatus(id, parsed.data.turnId, parsed.data.status);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/chat] status update failed", err);
    return json({ error: "db_error" }, 500);
  }
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
