import { searchChatUsers } from "@/lib/chat/store";
import { json, loadChatSite, requireChatSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ error: "unauthorized" }, 401);

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const users = await searchChatUsers(site.projectId, q, session.user.id);
  return json({ users }, 200);
}
