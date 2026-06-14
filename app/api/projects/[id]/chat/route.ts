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
