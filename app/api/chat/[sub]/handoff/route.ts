import { json, loadChatSite, requireChatSession } from "../_shared";
import { buildChatCookie } from "@/lib/chat/session";
import {
  createChatSession,
  createGuestChatUser,
  getOrCreateConversation,
  getOrCreateOwnerChatUser,
  insertMessage,
  recordChatEvent,
} from "@/lib/chat/store";
import { sanitizeDisplayName } from "@/lib/chat/identity";
import { checkAndConsume, getClientIp, IP_LIMITS, ipLimitKey } from "@/lib/limits";
import { notifyOwnerIfOffline } from "@/lib/chat/notify";
import { hub } from "@/lib/chat/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TRANSCRIPT = 4000;

// POST /api/chat/[sub]/handoff — escalate an AI-assistant chat to a human.
//
// Called by the site-assistant widget RELATIVELY (so the ol_chat cookie lands
// on the published subdomain the human chat widget also uses — a cross-origin
// call to the apex would drop the cookie). Opens a conversation with the owner
// tagged origin="ai_handoff", seeds it with the AI transcript, and notifies the
// owner (live hub event + offline push/email). The visitor keeps talking as the
// same identity in the human widget (window.__openlenChat.openConversation).
//
// Identity: reuse the visitor's existing ol_chat session if present (so a
// re-escalation doesn't spawn a duplicate guest + thread); otherwise mint a
// fresh guest from the name/email the assistant captured.
//
// Requires chat enabled (the assistant only offers the button when it is). We
// deliberately allow it regardless of selfServeJoin/identityMode: the owner
// enabled BOTH surfaces, so an assistant-driven escalation is intended even on
// an otherwise invite-only or account-mode chat.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);

  // Only the merged both-surfaces config exposes handoff: the assistant must be
  // on (it's the caller) AND the chat must be a guest self-serve space (we mint
  // a guest). Mirrors the auth/guest gate so an assistant-off or
  // invite-only/account-mode chat can't be used to bypass the identity policy.
  const assistantOn = process.env.OPENLEN_ASSISTANT !== "0" && site.assistantEnabled;
  if (!assistantOn) return json({ error: "not_found" }, 404);
  if (!site.selfServeJoin) return json({ error: "invite_only" }, 403);
  if (site.identityMode !== "guest") return json({ error: "not_allowed" }, 403);

  // Same anti-abuse budget as guest signup — this can create a guest chat user.
  const limit = await checkAndConsume(ipLimitKey(getClientIp(req), "chat_guest"), IP_LIMITS.chat_guest);
  if (!limit.ok) return json({ error: "rate_limited" }, 429);

  let body: { name?: unknown; email?: unknown; transcript?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body tolerated below via validation */
  }

  let email: string | null = null;
  if (typeof body.email === "string" && body.email.trim()) {
    const e = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) {
      return json({ error: "bad_email" }, 400);
    }
    email = e;
  }
  const transcript = (typeof body.transcript === "string" ? body.transcript : "")
    .trim()
    .slice(0, MAX_TRANSCRIPT);

  // Reuse an existing guest session if the visitor already has one on this sub;
  // else mint a fresh guest + session cookie.
  const existing = await requireChatSession(req, site.projectId);
  let userId: string;
  let displayName: string;
  let setCookie: string | null = null;
  if (existing) {
    userId = existing.user.id;
    displayName = existing.user.displayName || "Visitante";
  } else {
    const name = sanitizeDisplayName(typeof body.name === "string" ? body.name : "");
    if (!name) return json({ error: "bad_name" }, 400);
    const cu = await createGuestChatUser(site.projectId, { displayName: name, email });
    userId = cu.id;
    displayName = name;
    const token = await createChatSession(site.projectId, cu.id);
    setCookie = buildChatCookie(token);
    recordChatEvent(site.projectId, "register", cu.id);
  }

  // Conversation with the owner, tagged as an assistant escalation. Idempotent
  // on the (visitor, owner) pair so a re-escalation reuses the same thread.
  const owner = await getOrCreateOwnerChatUser(site.projectId, site.userId, {
    displayName: site.title,
  });
  // Owner previewing their own site (logged in as the owner chat user) must not
  // open a degenerate self-conversation.
  if (userId === owner.id) return json({ error: "self" }, 400);
  const convo = await getOrCreateConversation(site.projectId, userId, owner.id, {
    origin: "ai_handoff",
  });

  // Seed the thread so the owner opens onto real context, not an empty pane.
  const seed = transcript
    ? `👋 ${displayName} venía del asistente. Resumen de la conversación:\n\n${transcript}`
    : `👋 ${displayName} pidió hablar con una persona desde el asistente.`;
  const m = await insertMessage(convo.id, userId, seed);
  recordChatEvent(site.projectId, "message", userId);
  hub.publish(convo.id, { type: "message", message: m });
  void notifyOwnerIfOffline(site.projectId, convo.id, userId, seed).catch((e) =>
    console.error("[chat] handoff notify failed", e),
  );

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(
    JSON.stringify({ conversation: { id: convo.id, otherUserId: owner.id } }),
    { status: 200, headers },
  );
}
