import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sendChatNotificationEmail, sendLiveSheetBrokenEmail } from "@/lib/email";
import type { NotificationChannel, NotificationEvent, DeliveryResult } from "../types";

export const emailChannel: NotificationChannel = {
  id: "email",

  isEnabled: (prefs) => prefs.emailEnabled,

  async send(event: NotificationEvent): Promise<DeliveryResult> {
    // Resolve recipient's platform email + display name
    const userRows = await db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, event.recipientUserId))
      .limit(1);

    const email = userRows[0]?.email ?? null;
    if (!email) return "skipped";

    const ownerName = userRows[0]?.name ?? null;

    // Resolve project title for subject line
    const projectRows = await db
      .select({ title: schema.projects.title })
      .from(schema.projects)
      .where(eq(schema.projects.id, event.projectId))
      .limit(1);

    const projectTitle = projectRows[0]?.title ?? event.projectId;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";

    // Throws on Resend error → caller can retry (both branches)
    if (event.type === "chat_message") {
      await sendChatNotificationEmail({
        to: email,
        ownerName,
        senderName: event.senderName,
        messageBody: event.preview,
        deskUrl: `${siteUrl}/inbox`,
        projectTitle,
      });
    } else {
      await sendLiveSheetBrokenEmail({
        to: email,
        projectTitle,
        missingCount: event.missingCount,
        editorUrl: `${siteUrl}/new?project=${event.projectId}`,
      });
    }

    return "sent";
  },
};
