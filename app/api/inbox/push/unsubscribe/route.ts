import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { json } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/inbox/push/unsubscribe — delete a specific PushSubscription for the logged-in user. */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const endpoint = body?.endpoint;
  if (!endpoint) return json({ error: "missing endpoint" }, 400);

  await db
    .delete(schema.pushSubscriptions)
    .where(
      and(
        eq(schema.pushSubscriptions.endpoint, endpoint),
        eq(schema.pushSubscriptions.userId, session.user.id),
      ),
    );

  return json({ ok: true }, 200);
}
