import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { json, requireOwnerForConversation } from "../../_shared";
import { resolveProjectAccess } from "@/lib/chat/agents";
import { assignConversation } from "@/lib/chat/store";
import { hub } from "@/lib/chat/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/inbox/[conversationId]/assign
 *
 * Body: { userId?: string | null }
 *   - absent or === session user → claim to self
 *   - null → release
 *   - other userId → reassign (owner-only; target must be owner or active agent)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await params;

  const ctx = await requireOwnerForConversation(conversationId);
  if ("error" in ctx)
    return json({ error: ctx.error === 401 ? "unauthorized" : "not_found" }, ctx.error);

  let parsed: { userId?: string | null } = {};
  try {
    parsed = await req.json();
  } catch {
    // empty body → claim to self
  }

  const { userId: callerId, projectId } = ctx;

  // Determine assignment target
  let target: string | null;
  if (parsed.userId === undefined || parsed.userId === callerId) {
    // claim to self
    target = callerId;
  } else if (parsed.userId === null) {
    // release
    target = null;
  } else {
    // reassign to another platform user → owner-only
    const access = await resolveProjectAccess(projectId, callerId);
    if (access !== "owner") return json({ error: "forbidden" }, 403);
    // Validate the target is owner or active agent of this project
    const targetAccess = await resolveProjectAccess(projectId, parsed.userId);
    if (!targetAccess) return json({ error: "target_not_staff" }, 400);
    target = parsed.userId;
  }

  const result = await assignConversation(projectId, conversationId, target);
  if ("error" in result) return json({ error: "not_found" }, 404);

  // Resolve assignee display name for the event
  let assigneeName: string | null = null;
  if (target) {
    const rows = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, target))
      .limit(1);
    assigneeName = rows[0]?.name ?? null;
  }

  hub.publish(conversationId, {
    type: "assignment",
    conversationId,
    assignedUserId: result.assignedUserId,
    assigneeName,
    assignedAt: result.assignedAt?.toISOString() ?? null,
  });

  return json(
    {
      assignedUserId: result.assignedUserId,
      assigneeName,
      assignedAt: result.assignedAt?.toISOString() ?? null,
    },
    200,
  );
}
