// /api/len-email/inbound — LEN POR CORREO: un correo a la dirección de un
// proyecto (lib/len-email/address.ts) es un mensaje a Len en ese proyecto.
//
// No lo llama un navegador: lo llama el Worker de correo de Cloudflare
// (infra/len-email-worker), que recibe el correo, lo lee y lo manda aquí con
// `Authorization: Bearer <LEN_EMAIL_INBOUND_TOKEN>`. Sin ese secreto, 503.
//
// Lo que no pasa la puerta se TIRA en silencio (200 `ignored`): contestar a un
// remitente falso o a una respuesta automática sería mandar correo a quien no
// lo pidió. Lo que la pasa se APUNTA primero (`lenEmailRequests`, único por
// Message-ID: el mismo correo dos veces no lanza dos turnos) y luego arranca un
// turno en el servidor, como un `@Len` de un hilo; Len contesta por correo. Si
// el servidor se reinicia, `resumeEmailRequests` retoma lo apuntado.
import { timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { lenEmailDomain, projectIdFromAddress } from "@/lib/len-email/address";
import { detectLanguage, isAuthentic, isAutomatic, mailboxAddress, newReplyText } from "@/lib/len-email/inbound";
import { dedupeKeyOf, recentEmailRequests, recordEmailRequest } from "@/lib/len-email/requests";
import { resumeEmailRequests, startEmailRequest } from "@/lib/len-email/run";
import { accesoAlProyecto, puede } from "@/lib/projects/acceso";
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

export async function POST(req: Request): Promise<Response> {
  const token = process.env.LEN_EMAIL_INBOUND_TOKEN?.trim();
  if (!token || !lenEmailDomain()) return json({ error: "len email is not configured" }, 503);
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
  if ((await recentEmailRequests(projectId)) >= MAX_PER_HOUR) return ignored("tope por hora");

  // Primero se apunta; luego se trabaja. `userId` es quien escribió: el turno
  // resuelve si es el dueño o un editor (y cobra al dueño), como en el chat.
  const request = await recordEmailRequest({
    dedupeKey: dedupeKeyOf({ messageId: mail.messageId, sender, to: mail.to, subject: mail.subject, text: mail.text }),
    projectId,
    userId: user.id,
    sender,
    subject: mail.subject,
    texto,
    idioma: detectLanguage(texto),
    inReplyTo: mail.messageId ?? null,
  });
  if (!request) return ignored("duplicado");
  // Lo que un reinicio dejó a medias, por si este proceso aún no lo retomó.
  void resumeEmailRequests();
  await startEmailRequest(request);
  return json({ ok: true, turnId: request.id }, 202);
}
