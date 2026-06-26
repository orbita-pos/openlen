import { normalizeUsername } from "@/lib/chat/identity";
import {
  getChatUserByUsername, getOrCreateConversation, listConversations,
} from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);
  const conversations = await listConversations(site.projectId, session.user.id);
  return json({ conversations }, 200);
}

export async function POST(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);

  let body: { username?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
  if (!username) return json({ error: "bad_request" }, 400);
  if (username === session.user.username) return json({ error: "self" }, 400);

  const other = await getChatUserByUsername(site.projectId, username);
  if (!other || other.status !== "active") return json({ error: "user_not_found" }, 404);

  const convo = await getOrCreateConversation(site.projectId, session.user.id, other.id);
  return json({ conversation: { id: convo.id, otherUserId: other.id } }, 200);
}
