import { hub } from "@/lib/chat/hub";
import { getConversationForUser } from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;

  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);

  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);

  let body: { conversationId?: unknown; isTyping?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!conversationId) return json({ error: "bad_request" }, 400);

  const convo = await getConversationForUser(site.projectId, conversationId, session.user.id);
  if (!convo) return json({ error: "not_found" }, 404);

  hub.publish(conversationId, {
    type: "typing",
    userId: session.user.id,
    isTyping: !!body.isTyping,
  });

  return new Response(null, { status: 204 });
}
