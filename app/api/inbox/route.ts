import { auth } from "@/auth";
import { listInbox } from "@/lib/chat/store";
import { json } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/inbox — the user's cross-project conversation inbox (owned + agent projects). */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const inbox = await listInbox(session.user.id);
  return json({ inbox }, 200);
}
