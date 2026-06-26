import { getClientIp, ipLimitKey, checkAndConsume, IP_LIMITS } from "@/lib/limits";
import { buildChatCookie } from "@/lib/chat/session";
import {
  hashPassword, isValidPassword, isValidUsername, normalizeUsername, sanitizeDisplayName,
} from "@/lib/chat/identity";
import { createChatSession, recordChatEvent, registerChatUser } from "@/lib/chat/store";
import { json, loadChatSite } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  if (!site.selfServeJoin) return json({ error: "invite_only" }, 403);

  const limit = await checkAndConsume(ipLimitKey(getClientIp(req), "chat_register"), IP_LIMITS.chat_register);
  if (!limit.ok) return json({ error: "rate_limited" }, 429);

  let body: { username?: unknown; password?: unknown; displayName?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidUsername(username)) return json({ error: "bad_username" }, 400);
  if (!isValidPassword(password)) return json({ error: "bad_password" }, 400);
  const displayName = typeof body.displayName === "string" ? sanitizeDisplayName(body.displayName) : null;

  const created = await registerChatUser(site.projectId, username, await hashPassword(password), { displayName });
  if ("error" in created) return json({ error: "username_taken" }, 409);

  const token = await createChatSession(site.projectId, created.id);
  recordChatEvent(site.projectId, "register", created.id);
  return new Response(JSON.stringify({ user: { id: created.id, username, displayName } }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": buildChatCookie(token) },
  });
}
