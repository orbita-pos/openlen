import { getClientIp, ipLimitKey, checkAndConsume, IP_LIMITS } from "@/lib/limits";
import { buildChatCookie } from "@/lib/chat/session";
import { isValidPassword, normalizeUsername, verifyPassword } from "@/lib/chat/identity";
import { createChatSession, getChatUserByUsername, recordChatEvent } from "@/lib/chat/store";
import { json, loadChatSite } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A valid cost-12 bcrypt hash compared against when the username is unknown,
// so login always takes full bcrypt cost and can't be used to enumerate usernames.
const DUMMY_HASH = "$2b$12$U5g.9HqlMGI8.St.ytB.UOFWQvr6z7dw7cT/wJPYNWRwoOfNzy/ua";

export async function POST(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);

  const limit = await checkAndConsume(ipLimitKey(getClientIp(req), "chat_login"), IP_LIMITS.chat_login);
  if (!limit.ok) return json({ error: "rate_limited" }, 429);

  let body: { username?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !isValidPassword(password)) return json({ error: "invalid" }, 401);

  const user = await getChatUserByUsername(site.projectId, username);
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || user.status !== "active" || !passwordOk) {
    return json({ error: "invalid" }, 401);
  }

  const token = await createChatSession(site.projectId, user.id);
  recordChatEvent(site.projectId, "login", user.id);
  return new Response(JSON.stringify({ user: { id: user.id, username: user.username, displayName: user.displayName } }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": buildChatCookie(token) },
  });
}
