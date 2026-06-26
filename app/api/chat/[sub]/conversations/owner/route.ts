import { getOrCreateConversation, getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../../_shared";

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
  const owner = await getOrCreateOwnerChatUser(site.projectId, site.userId, {
    displayName: site.title,
  });
  if (owner.id === session.user.id) return json({ error: "self" }, 400);
  const convo = await getOrCreateConversation(site.projectId, session.user.id, owner.id);
  return json({ conversation: { id: convo.id, otherUserId: owner.id } }, 200);
}
