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
  status: z.enum(["running", "done", "error"]),
  // Truncate, don't reject: a model-written summary that runs long must not
  // 400 the whole turn (which vanishes silently on reload). tool/actions-count
  // stay hard structural rejects below.
  summary: z.string().transform((s) => s.slice(0, 200)),
  /** Cuántas ediciones aplicó esta llamada. */
  edits: z.number().int().min(0).max(10_000).optional(),
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
});

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
  actions: z.array(ActionSchema).max(12).optional(),
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
