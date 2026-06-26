import { clearChatCookie, readChatCookie } from "@/lib/chat/session";
import { deleteChatSessionByRaw, recordChatEvent } from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site) return json({ error: "not_found" }, 404);

  const session = await requireChatSession(req, site.projectId);
  const raw = readChatCookie(req);
  if (raw) await deleteChatSessionByRaw(raw);
  if (session) recordChatEvent(site.projectId, "logout", session.user.id);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": clearChatCookie() },
  });
}
