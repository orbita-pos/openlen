import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { json } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/inbox/badge/seen — mark ALL leads as seen (opening the
 *  Formularios tab). Chat read-state is per-thread and already handled by the
 *  Desk messages GET — this endpoint never touches it. */
export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  await db
    .update(schema.users)
    // DB clock, not the app server's — the count compares this watermark
    // against formSubmissions.createdAt (defaultNow), so both sides must
    // come from the same clock or skew re-opens the seen-vs-new race.
    .set({ lastSeenLeadsAt: sql`now()` })
    .where(eq(schema.users.id, session.user.id));
  return json({ ok: true }, 200);
}
