import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);
  const session = await requireChatSession(req, site.projectId);
  if (!session) return json({ user: null }, 200);
  const { id, username, displayName } = session.user;
  return json({ user: { id, username, displayName } }, 200);
}
