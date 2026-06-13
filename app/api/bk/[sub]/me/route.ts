import { json, loadBookingsSite, resolveMember } from "../_shared";

// GET /api/bk/[sub]/me — the widget's "am I logged in?" probe so it can prefill
// the booking form and skip the name/email fields for a member. The ol_member
// cookie is HttpOnly; this credentialed call is the server-side source of truth.
// Never returns the email — only whether a session resolves + the display name.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadBookingsSite(sub);
  if (!site) return json({ member: false }, 200);
  const member = await resolveMember(req, site.projectId);
  if (!member) return json({ member: false, requireLogin: site.requireLogin }, 200);
  return json({ member: true, name: member.name, requireLogin: site.requireLogin }, 200);
}
