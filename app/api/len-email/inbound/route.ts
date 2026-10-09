// /api/len-email/inbound — LEN POR CORREO: un correo a la dirección de un
// proyecto (lib/len-email/address.ts) es un mensaje a Len en ese proyecto.
//
// No lo llama un navegador: lo llama el Worker de correo de Cloudflare
// (infra/len-email-worker), que recibe el correo, lo lee y lo manda aquí con
// `Authorization: Bearer <LEN_EMAIL_INBOUND_TOKEN>`. Sin ese secreto, 503.
//
// Lo que no pasa la puerta se TIRA en silencio (200 `ignored`): contestar a un
// remitente falso o a una respuesta automática sería mandar correo a quien no
// lo pidió. Lo que la pasa arranca un turno en el servidor, como un `@Len` de
// un hilo (lib/agent/turnos-desde-el-servidor.ts), y Len contesta por correo.
import { timingSafeEqual } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { launchEmailTurn } from "@/lib/agent/turnos-desde-el-servidor";
import { db, schema } from "@/lib/db";
import { sendLenReplyEmail } from "@/lib/email";
import { lenEmailAddress, projectIdFromAddress } from "@/lib/len-email/address";
import { contextForModel, detectLanguage, isAuthentic, isAutomatic, mailboxAddress, newReplyText } from "@/lib/len-email/inbound";
import { urlDelChat } from "@/lib/notifications/channels/webpush";
import { accesoAlProyecto, puede } from "@/lib/projects/acceso";
import { fraseDeFalloPorCorreo } from "@/lib/projects/correos-del-proyecto";
import { MAX_PROMPT } from "@/lib/workspace-v2/comentarios-de-lineas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quién firma la primera `Authentication-Results`: el receptor de Cloudflare. */
const DEFAULT_AUTHSERV_ID = "mx.cloudflare.net";
/** Tope de correos a Len por proyecto y hora: un bucle o un abuso no vacía los créditos. */
const MAX_PER_HOUR = 20;

const Inbound = z.object({
  to: z.string().max(320),
  from: z.string().max(1000),
  subject: z.string().max(2000).default(""),
  text: z.string().max(200_000).default(""),
  messageId: z.string().max(1000).nullish(),
  /** La PRIMERA `Authentication-Results` (la del último salto: el nuestro). */
  authenticationResults: z.string().max(5000).nullish(),
  /** La PRIMERA `ARC-Authentication-Results`, por si el receptor sólo firma ARC. */
  arcAuthenticationResults: z.string().max(5000).nullish(),
  autoSubmitted: z.string().max(200).nullish(),
  precedence: z.string().max(200).nullish(),
  listId: z.string().max(1000).nullish(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ignored = (reason: string) => {
  console.info(`[len-email] ignorado: ${reason}`);
  return json({ ok: true, ignored: reason });
};

function authorized(req: Request, token: string): boolean {
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const recent = new Map<string, number[]>();
function underLimit(projectId: string, now = Date.now()): boolean {
  const hits = (recent.get(projectId) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.length >= MAX_PER_HOUR) return false;
  hits.push(now);
  recent.set(projectId, hits);
  return true;
}

export async function POST(req: Request): Promise<Response> {
  const token = process.env.LEN_EMAIL_INBOUND_TOKEN?.trim();
  if (!token) return json({ error: "len email is not configured" }, 503);
  if (!authorized(req, token)) return json({ error: "unauthorized" }, 401);

  const parsed = Inbound.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad request" }, 400);
  const mail = parsed.data;

  if (isAutomatic(mail)) return ignored("automático");
  const projectId = projectIdFromAddress(mail.to);
  if (!projectId) return ignored("dirección desconocida");
  const sender = mailboxAddress(mail.from);
  if (!sender) return ignored("remitente ilegible");
  const authservId = process.env.LEN_EMAIL_AUTHSERV_ID?.trim() || DEFAULT_AUTHSERV_ID;
  if (!isAuthentic(mail.authenticationResults, sender, authservId) && !isAuthentic(mail.arcAuthenticationResults, sender, authservId)) {
    return ignored("sin DKIM/DMARC de su dominio");
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${sender}`)
    .limit(1);
  if (!user) return ignored("remitente sin cuenta");
  const acceso = await accesoAlProyecto(projectId, user.id);
  if (!acceso || !puede(acceso.rol, "editar")) return ignored("remitente sin permiso en el proyecto");

  const texto = newReplyText(mail.text).slice(0, MAX_PROMPT);
  if (!texto) return ignored("correo vacío");
  if (!underLimit(projectId)) return ignored("tope por hora");

  const [project] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
  const idioma = detectLanguage(texto);
  const replyTo = lenEmailAddress(projectId);
  if (!replyTo) return json({ error: "len email is not configured" }, 503);
  const reply = (text: string) =>
    sendLenReplyEmail({
      to: sender,
      replyTo,
      idioma,
      inReplyTo: mail.messageId ?? null,
      projectTitle: project?.title ?? "",
      asunto: mail.subject,
      texto: text,
      url: siteUrl + urlDelChat(projectId),
    });

  // `userId` es quien escribió: el turno resuelve si es el dueño o un editor
  // (y entonces cobra al dueño, con el tope de los miembros), como en el chat.
  const { filaId } = await launchEmailTurn({
    userId: user.id,
    projectId,
    texto,
    context: contextForModel(mail.subject),
    origen: `${siteUrl}/api/agent`,
    reply,
    fraseDeFallo: (fallo) => fraseDeFalloPorCorreo(idioma, fallo),
  });
  return json({ ok: true, turnId: filaId }, 202);
}
