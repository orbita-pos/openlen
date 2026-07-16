import { auth } from "@/auth";
import { countInboxBadge } from "@/lib/inbox/badge";
import { json } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/inbox/badge — unread-chat + new-leads counts for the rail badge.
 *  Two integers, zero PII. Ignores the business switcher on purpose (global). */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const counts = await countInboxBadge(session.user.id);
  return json(counts, 200);
}
