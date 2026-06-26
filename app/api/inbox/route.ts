import { auth } from "@/auth";
import { listOwnerInbox } from "@/lib/chat/store";
import { json } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/inbox — the owner's cross-project conversation inbox. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const inbox = await listOwnerInbox(session.user.id);
  return json({ inbox }, 200);
}
