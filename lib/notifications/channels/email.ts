import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sendChatNotificationEmail, sendMentionEmail } from "@/lib/email";
import type { NotificationChannel, NotificationEvent, DeliveryResult, MencionEvent } from "../types";
import { urlDelChat, urlDelHilo } from "./webpush";

export const emailChannel: NotificationChannel = {
  id: "email",

  isEnabled: (prefs) => prefs.emailEnabled,

  async send(event: NotificationEvent): Promise<DeliveryResult> {
    // Len 2.1: el aviso de turno terminado es SÓLO push. Un correo por cada
    // turno que termina sin nadie mirando sería ruido, y quien lo necesita de
    // verdad —la app móvil— vive de push.
    if (event.type === "len_turno") return "skipped";
    if (event.type === "mencion") return enviarMencion(event);
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

    // Throws on Resend error → caller can retry. (Hasta Len 2.1 había otra
    // rama, la del Sheet de datos vivos que dejó de leerse.)
    await sendChatNotificationEmail({
      to: email,
      ownerName,
      senderName: event.senderName,
      messageBody: event.preview,
      deskUrl: `${siteUrl}/inbox`,
      projectTitle,
    });

    return "sent";
  },
};

/** «Te mencionaron» en un hilo del código: al correo de quien mencionaron. */
async function enviarMencion(event: MencionEvent): Promise<DeliveryResult> {
  const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, event.recipientUserId)).limit(1);
  if (!u?.email) return "skipped";
  const [p] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, event.projectId)).limit(1);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
  const enElChat = event.donde === "chat" || !event.ruta;
  await sendMentionEmail({
    to: u.email,
    idioma: event.idioma ?? null,
    projectTitle: p?.title ?? "",
    quien: event.quien,
    ...(enElChat ? { donde: "chat" as const } : { ruta: event.ruta!, linea: event.linea ?? 1 }),
    texto: event.preview,
    url: siteUrl + (enElChat ? urlDelChat(event.projectId) : urlDelHilo(event.projectId, event.ruta!)),
  });
  return "sent";
}
