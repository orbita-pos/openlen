import { readMemberCookie } from "@/lib/members/session";
import { getMemberSession, getMemberById } from "@/lib/members/store";
import { buildChatCookie } from "@/lib/chat/session";
import { createChatSession, findOrCreateMemberChatUser, getChatUserById } from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);

  const session = await requireChatSession(req, site.projectId);
  if (session) {
    const { id, username, displayName } = session.user;
    return json({ user: { id, username, displayName } }, 200);
  }

  // Member bridge: an already-logged-in site member is auto-identified into chat.
  const memberRaw = readMemberCookie(req);
  if (memberRaw) {
    const ms = await getMemberSession(memberRaw);
    if (ms && ms.projectId === site.projectId) {
      const member = await getMemberById(ms.memberId);
      if (member && member.status === "active") {
        const cu = await findOrCreateMemberChatUser(site.projectId, { id: member.id, name: member.name, email: member.email });
        const token = await createChatSession(site.projectId, cu.id);
        const u = await getChatUserById(cu.id);
        return new Response(JSON.stringify({ user: { id: u!.id, username: u!.username, displayName: u!.displayName } }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": buildChatCookie(token) },
        });
      }
    }
  }

  return json({ user: null }, 200);
}
