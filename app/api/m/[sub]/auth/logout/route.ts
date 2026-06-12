import { clearMemberCookie } from "@/lib/members/session";
import { json } from "../../_shared";

// POST /api/m/[sub]/auth/logout — clears the member cookie on this host.
// No v1 UI calls it yet; it exists so a site can wire its own "log out"
// link without waiting on us.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const res = json({ ok: true }, 200);
  res.headers.append("set-cookie", clearMemberCookie());
  return res;
}
