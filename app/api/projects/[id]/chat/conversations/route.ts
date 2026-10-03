import { z } from "zod";
import { auth } from "@/auth";
import {
  isProjectOwner,
  listArchivedConversations,
  reopenConversation,
  startNewConversation,
} from "@/lib/projects/chat";

// ─────────────────────────────────────────────────────────────────────────────
// LAS CHARLAS DEL PROYECTO (plans/new-chat/, decisión de Jesús del 03/10).
//
// GET  → las archivadas, de la más reciente a la más vieja.
// POST { action: "new" }                       → «Empezar de cero»: archiva la
//                                                 charla en curso.
// POST { action: "reopen", conversation: id }  → vuelve a una archivada (y
//                                                 archiva la que hubiera).
//
// 409 `busy` mientras un turno trabaja: cambiar de charla con un turno en
// marcha dejaría su fila en una charla que ya no se ve. La memoria de Len y las
// notas de la página no se tocan (ver `lib/projects/chat.ts`).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("new") }),
  z.object({ action: z.literal("reopen"), conversation: z.string().min(1).max(100) }),
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await isProjectOwner(id, session.user.id))) return json({ error: "not_found" }, 404);
  try {
    return json({ conversations: await listArchivedConversations(id) }, 200);
  } catch (err) {
    console.error("[projects/chat/conversations] list failed", err);
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
    const r =
      parsed.data.action === "new"
        ? await startNewConversation(id)
        : await reopenConversation(id, parsed.data.conversation);
    if (!r.ok) return json({ error: r.reason }, r.reason === "busy" ? 409 : 404);
    return json({ ok: true, archived: r.archived }, 200);
  } catch (err) {
    console.error("[projects/chat/conversations] change failed", err);
    return json({ error: "db_error" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
