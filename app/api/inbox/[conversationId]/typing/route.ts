import { hub } from "@/lib/chat/hub";
import { json, requireOwnerForConversation } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await params;

  const ctx = await requireOwnerForConversation(conversationId);
  if ("error" in ctx)
    return json(
      { error: ctx.error === 401 ? "unauthorized" : "not_found" },
      ctx.error,
    );

  let body: { isTyping?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  hub.publish(conversationId, {
    type: "typing",
    userId: ctx.ownerChatUserId,
    isTyping: !!body.isTyping,
  });

  return new Response(null, { status: 204 });
}
