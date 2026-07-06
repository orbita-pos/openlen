import { readMemberCookie } from "@/lib/members/session";
import {
  getMemberById,
  getMemberSession,
  maybeTouchMemberSession,
} from "@/lib/members/store";
import { listMemberBookings } from "@/lib/bookings/store";
import { json, loadMemberSite } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/m/[sub]/me — the session member's own profile + bookings, for the
// account dashboard (/cuenta). Session-gated; nothing is trusted from the
// request body. no-store (json()). Unverified members ARE served here (the
// dashboard shows the "confirm your email" chip) — verification only gates
// protected pages, not the account view.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  if (!site.membersEnabled) return json({ error: "auth" }, 401);

  const cookie = readMemberCookie(req);
  const session = cookie ? await getMemberSession(cookie) : null;
  if (!session || session.projectId !== site.projectId) {
    return json({ error: "auth" }, 401);
  }
  const member = await getMemberById(session.memberId);
  if (!member || member.status !== "active") return json({ error: "auth" }, 401);
  maybeTouchMemberSession(session);

  const bookings = site.bookingsEnabled
    ? await listMemberBookings(site.projectId, member.id)
    : [];
  return json(
    {
      name: member.name,
      email: member.email,
      verified: member.emailVerifiedAt !== null,
      bookings: bookings.map((b) => ({
        service: b.serviceName,
        startUtc: b.startUtc,
        status: b.status,
      })),
    },
    200,
  );
}
