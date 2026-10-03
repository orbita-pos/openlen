import { z } from "zod";
import { auth } from "@/auth";
import { isProjectOwner } from "@/lib/projects/chat";
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_REASONS,
  listTurnFeedback,
  removeTurnFeedback,
  saveTurnFeedback,
} from "@/lib/chat/feedback";

// ─────────────────────────────────────────────────────────────────────────────
// ¿TE SIRVIÓ? — el 👍/👎 de cada turno del chat (plans/new-chat/, decisión de
// Jesús del 03/10: «construirlo y guardarlo»).
//
// GET    → tus votos en este proyecto, por turno (para pintarlos al recargar).
// POST   { turnId, rating: "up"|"down", reasons?, note? } → vota o cambia el voto.
// DELETE { turnId } → quita el voto.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostSchema = z.object({
  turnId: z.string().min(1).max(100),
  rating: z.enum(["up", "down"]),
  // Un motivo desconocido se DESCARTA, no tira el voto: el voto es lo que
  // importa, y un cliente viejo no debería perderlo por un código nuevo.
  reasons: z
    .array(z.string().max(40))
    .max(FEEDBACK_REASONS.length * 2)
    .optional(),
  // Se recorta, no se rechaza, como los textos de la ruta del chat.
  note: z
    .string()
    .transform((s) => s.slice(0, FEEDBACK_NOTE_MAX))
    .optional(),
});

const DeleteSchema = z.object({ turnId: z.string().min(1).max(100) });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await isProjectOwner(id, session.user.id))) return json({ error: "not_found" }, 404);
  try {
    return json({ feedback: await listTurnFeedback(id, session.user.id) }, 200);
  } catch (err) {
    console.error("[projects/chat/feedback] list failed", err);
    return json({ error: "db_error" }, 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await isProjectOwner(id, session.user.id))) return json({ error: "not_found" }, 404);
  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "invalid" }, 400);
  try {
    await saveTurnFeedback(id, session.user.id, parsed.data.turnId, {
      rating: parsed.data.rating,
      reasons: (parsed.data.reasons ?? []).filter((r): r is (typeof FEEDBACK_REASONS)[number] =>
        (FEEDBACK_REASONS as readonly string[]).includes(r),
      ),
      note: parsed.data.note ?? null,
    });
    return json({ ok: true }, 200);
  } catch (err) {
    console.error("[projects/chat/feedback] save failed", err);
    return json({ error: "db_error" }, 500);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await isProjectOwner(id, session.user.id))) return json({ error: "not_found" }, 404);
  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "invalid" }, 400);
  try {
    await removeTurnFeedback(id, session.user.id, parsed.data.turnId);
    return json({ ok: true }, 200);
  } catch (err) {
    console.error("[projects/chat/feedback] remove failed", err);
    return json({ error: "db_error" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
