import { json, loadChatSite } from "../../_shared";
import { buildChatCookie } from "@/lib/chat/session";
import { createGuestChatUser, createChatSession, recordChatEvent } from "@/lib/chat/store";
import { sanitizeDisplayName } from "@/lib/chat/identity";
import { checkAndConsume, ipLimitKey, getClientIp, IP_LIMITS } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  if (!site.selfServeJoin) return json({ error: "invite_only" }, 403);
  if (site.identityMode !== "guest") return json({ error: "not_allowed" }, 403);

  const limit = await checkAndConsume(ipLimitKey(getClientIp(req), "chat_guest"), IP_LIMITS.chat_guest);
  if (!limit.ok) return json({ error: "rate_limited" }, 429);

  let body: { name?: unknown; email?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const name = sanitizeDisplayName(typeof body.name === "string" ? body.name : "");
  if (!name) return json({ error: "bad_name" }, 400);
  let email: string | null = null;
  if (typeof body.email === "string" && body.email.trim()) {
    const e = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) return json({ error: "bad_email" }, 400);
    email = e;
  }

  const cu = await createGuestChatUser(site.projectId, { displayName: name, email });
  const token = await createChatSession(site.projectId, cu.id);
  recordChatEvent(site.projectId, "register", cu.id);
  return new Response(JSON.stringify({ user: { id: cu.id, username: null, displayName: name } }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": buildChatCookie(token) },
  });
}
