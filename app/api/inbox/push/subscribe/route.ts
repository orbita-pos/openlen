import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { json } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/inbox/push/subscribe — upsert a PushSubscription for the logged-in user. */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; [k: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const authKey = body?.keys?.auth;

  if (!endpoint || !p256dh || !authKey) {
    return json({ error: "missing endpoint or keys" }, 400);
  }

  const userAgent = req.headers.get("user-agent") ?? undefined;

  await db
    .insert(schema.pushSubscriptions)
    .values({
      endpoint,
      userId: session.user.id,
      p256dh,
      auth: authKey,
      userAgent,
      lastUsedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: {
        userId: session.user.id,
        p256dh,
        auth: authKey,
        lastUsedAt: new Date(),
      },
    });

  return json({ ok: true }, 200);
}
