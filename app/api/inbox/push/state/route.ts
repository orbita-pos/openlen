import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { json } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/inbox/push/state — returns the VAPID public key + whether this user has any subscription. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const rows = await db
    .select({ endpoint: schema.pushSubscriptions.endpoint })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, session.user.id))
    .limit(1);

  return json(
    {
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
      subscribed: rows.length > 0,
    },
    200,
  );
}
