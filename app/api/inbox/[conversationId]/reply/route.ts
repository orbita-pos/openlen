import { insertMessage } from "@/lib/chat/store";
import { json, requireOwnerForConversation } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4000;

/** POST /api/inbox/[conversationId]/reply — owner sends a message as the business. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await params;
  const ctx = await requireOwnerForConversation(conversationId);
  if ("error" in ctx) return json({ error: ctx.error === 401 ? "unauthorized" : "not_found" }, ctx.error);

  let parsed: { body?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const text = (typeof parsed.body === "string" ? parsed.body : "").trim().slice(0, MAX_BODY);
  if (text.length === 0) return json({ error: "bad_request" }, 400);

  const m = await insertMessage(conversationId, ctx.ownerChatUserId, text);
  return json(
    {
      message: {
        id: m.id,
        authorId: m.authorId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        mine: true,
      },
    },
    200,
  );
}
