import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { NotificationChannel, NotificationEvent } from "../types";

// ── VAPID setup ────────────────────────────────────────────────────────────────
// Called lazily on first use so Next.js build / dev without keys don't crash.
let _vapidReady: boolean | null = null;
let _warnedOnce = false;

function isVapidReady(): boolean {
  if (_vapidReady !== null) return _vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (pub && priv && subj) {
    webpush.setVapidDetails(subj, pub, priv);
    _vapidReady = true;
  } else {
    _vapidReady = false;
  }
  return _vapidReady;
}

// ── Core send helper ───────────────────────────────────────────────────────────

export async function sendPushToUser(
  userId: string,
  payload: object,
): Promise<{ sent: number; failed: number }> {
  if (!isVapidReady()) {
    if (!_warnedOnce) {
      console.warn("[webpush] VAPID keys not configured — push disabled");
      _warnedOnce = true;
    }
    return { sent: 0, failed: 0 };
  }

  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId));

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      sent++;
      await db
        .update(schema.pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.pushSubscriptions.endpoint, sub.endpoint));
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.endpoint, sub.endpoint));
      } else {
        failed++;
      }
    }
  }

  return { sent, failed };
}

// ── Channel object ─────────────────────────────────────────────────────────────

export const webPushChannel: NotificationChannel = {
  id: "webpush",

  isEnabled: (prefs) => prefs.webPushEnabled,

  async send(event: NotificationEvent) {
    const payload = {
      title: event.senderName,
      body: event.preview,
      url: "/inbox?conv=" + event.conversationId,
    };

    const { sent, failed } = await sendPushToUser(event.recipientUserId, payload);

    if (sent > 0) return "sent";
    if (sent === 0 && failed > 0) {
      throw new Error("[webpush] All deliveries failed — will retry");
    }
    return "skipped"; // no subscriptions at all
  },
};
