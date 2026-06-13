import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { deleteBroadcast, updateBroadcastDraft } from "@/lib/broadcast/store";

// PATCH  /api/projects/[id]/broadcasts/[broadcastId] — edit a draft.
// DELETE /api/projects/[id]/broadcasts/[broadcastId] — remove (not while sending).
// Owner-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownsProject(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

const PatchSchema = z
  .object({
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
  })
  .refine((o) => o.subject !== undefined || o.body !== undefined, {
    message: "expected subject and/or body",
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; broadcastId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, broadcastId } = await params;
  if (!(await ownsProject(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  const updated = await updateBroadcastDraft(id, broadcastId, parsed.data);
  // null = not found OR no longer a draft (already sending/sent).
  if (!updated) return json({ error: "not_editable" }, 409);
  return json({ broadcast: updated }, 200);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; broadcastId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, broadcastId } = await params;
  if (!(await ownsProject(id, session.user.id))) return json({ error: "not_found" }, 404);

  const removed = await deleteBroadcast(id, broadcastId);
  if (!removed) return json({ error: "not_found_or_sending" }, 409);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
