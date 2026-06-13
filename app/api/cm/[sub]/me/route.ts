import { readMemberCookie } from "@/lib/members/session";
import { getMemberById, getMemberSession } from "@/lib/members/store";
import { json, loadCommentsSite } from "../_shared";

// GET /api/cm/[sub]/me — the widget's "am I logged in?" probe. The ol_member
// cookie is HttpOnly, so JS on the static page can't read it; this credentialed
// call makes the SERVER the source of truth for composer-vs-login. Returns the
// display name when a member session resolves, never the email.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadCommentsSite(sub);
  if (!site) return json({ member: false }, 200);

  const cookie = readMemberCookie(req);
  const session = cookie ? await getMemberSession(cookie) : null;
  if (!session || session.projectId !== site.projectId) {
    return json({ member: false }, 200);
  }
  const member = await getMemberById(session.memberId);
  if (!member || member.status !== "active") return json({ member: false }, 200);

  return json({ member: true, name: member.name }, 200);
}
