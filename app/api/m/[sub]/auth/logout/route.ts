import { clearMemberCookie, readMemberCookie } from "@/lib/members/session";
import {
  deleteMemberSessionByHash,
  getMemberSession,
  recordMemberAuthEvent,
} from "@/lib/members/store";
import { json } from "../../_shared";

// POST /api/m/[sub]/auth/logout — kills exactly the presented session row
// (server-side revocation, not just a cookie clear) and expires the cookie.
// No v1 UI calls it yet; it exists so a site can wire its own "log out"
// link without waiting on us.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const cookie = readMemberCookie(req);
  if (cookie) {
    const session = await getMemberSession(cookie);
    if (session) {
      await deleteMemberSessionByHash(session.tokenHash);
      recordMemberAuthEvent({
        projectId: session.projectId,
        memberId: session.memberId,
        type: "logout",
      });
    }
  }
  const res = json({ ok: true }, 200);
  res.headers.append("set-cookie", clearMemberCookie());
  return res;
}
