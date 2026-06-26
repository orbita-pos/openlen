import { getClientIp, ipLimitKey, checkAndConsume, type LimitWindow } from "@/lib/limits";
import { encodeCursor } from "@/lib/chat/cursor";
import {
  getConversationForUser, insertMessage, listMessagesSince, recordChatEvent,
} from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MSG_LIMIT: LimitWindow[] = [{ windowMs: 60 * 1000, max: 30, label: "per-minute" }];
const MAX_BODY = 4000;

export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId") ?? "";
  const since = url.searchParams.get("since");
  const convo = await getConversationForUser(site.projectId, conversationId, session.user.id);
  if (!convo) return json({ error: "not_found" }, 404);

  const rows = await listMessagesSince(conversationId, since);
  const messages = rows.map((m) => ({
    id: m.id, authorId: m.authorId, body: m.body, createdAt: m.createdAt.toISOString(),
    mine: m.authorId === session.user.id,
  }));
  const nextCursor = rows.length > 0 ? encodeCursor(rows[rows.length - 1]) : (since ?? null);
  return json({ messages, nextCursor }, 200);
}

export async function POST(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);

  const burst = await checkAndConsume(ipLimitKey(session.user.id, "chat_msg"), MSG_LIMIT);
  if (!burst.ok) return json({ error: "rate_limited" }, 429);

  let body: { conversationId?: unknown; body?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const text = (typeof body.body === "string" ? body.body : "").trim().slice(0, MAX_BODY);
  if (!conversationId || text.length === 0) return json({ error: "bad_request" }, 400);

  const convo = await getConversationForUser(site.projectId, conversationId, session.user.id);
  if (!convo) return json({ error: "not_found" }, 404);

  const m = await insertMessage(conversationId, session.user.id, text);
  recordChatEvent(site.projectId, "message", session.user.id);
  return json({ message: { id: m.id, authorId: m.authorId, body: m.body, createdAt: m.createdAt.toISOString(), mine: true } }, 200);
}
