/**
 * LEN POR CORREO — correr un correo ya apuntado (`lenEmailRequests`) y retomar
 * los que un reinicio dejó sin contestar. La respuesta se GUARDA antes de
 * mandarse y se marca después: si el envío se corta, se reenvía sin repetir el
 * turno (que ya cobró y ya cambió la página).
 */
import "server-only";

import { eq } from "drizzle-orm";

import { launchEmailTurn } from "@/lib/agent/turnos-desde-el-servidor";
import { db, schema } from "@/lib/db";
import { sendLenReplyEmail } from "@/lib/email";
import { lenEmailAddress, lenEmailDomain } from "@/lib/len-email/address";
import { contextForModel } from "@/lib/len-email/inbound";
import { markEmailReplied, saveEmailReply, unansweredEmailRequests, type EmailRequest } from "@/lib/len-email/requests";
import { urlDelChat } from "@/lib/notifications/channels/webpush";
import { fraseDeFalloPorCorreo, fraseDeInterrupcionPorCorreo, idiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
}

/** Guarda lo que Len dijo, lo manda a quien escribió y lo marca contestado. */
async function deliver(req: EmailRequest, texto: string): Promise<void> {
  await saveEmailReply(req.id, texto);
  const replyTo = lenEmailAddress(req.projectId);
  if (!replyTo) throw new Error("LEN_EMAIL_DOMAIN no está configurado: no hay a qué dirección contestar");
  const [project] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, req.projectId)).limit(1);
  await sendLenReplyEmail({
    to: req.sender,
    replyTo,
    idioma: idiomaDelCorreo(req.idioma),
    inReplyTo: req.inReplyTo,
    projectTitle: project?.title ?? "",
    asunto: req.subject,
    texto,
    url: siteUrl() + urlDelChat(req.projectId),
  });
  await markEmailReplied(req.id);
}

/** Lanza el turno del correo; vuelve en el acto. La fila del chat es el id del correo. */
export async function startEmailRequest(req: EmailRequest): Promise<void> {
  const idioma = idiomaDelCorreo(req.idioma);
  await launchEmailTurn({
    userId: req.userId,
    projectId: req.projectId,
    texto: req.texto,
    context: contextForModel(req.subject),
    origen: `${siteUrl()}/api/agent`,
    filaId: req.id,
    reply: (texto) => deliver(req, texto),
    fraseDeFallo: (fallo) => fraseDeFalloPorCorreo(idioma, fallo),
  });
}

/** Cuándo arrancó este proceso: lo apuntado antes, nadie de aquí lo corre. */
const STARTED_AT = new Date();
/** Pasado esto, un correo que no empezó ya no se corre solo (sorprendería). */
const RESUME_FOR_MS = 24 * 3_600_000;

let resuming: Promise<number> | null = null;

/**
 * Los correos que un reinicio dejó sin contestar: el que ya tiene respuesta se
 * reenvía; el que no empezó se corre (con su misma fila); el cortado a medias o
 * de hace más de un día, Len lo dice por correo. Una vez por proceso; nunca lanza.
 */
export function resumeEmailRequests(): Promise<number> {
  // Apagado (sin dominio), no hay correos que retomar: ni se consulta la tabla.
  if (!lenEmailDomain()) return Promise.resolve(0);
  resuming ??= resume().catch((err) => {
    console.error("[len-email] no se pudieron retomar los correos a Len", err);
    return 0;
  });
  return resuming;
}

async function resume(): Promise<number> {
  const pending = await unansweredEmailRequests(STARTED_AT);
  for (const req of pending) {
    const idioma = idiomaDelCorreo(req.idioma);
    try {
      if (req.respuesta !== null) await deliver(req, req.respuesta);
      else if (req.started) await deliver(req, fraseDeInterrupcionPorCorreo(idioma));
      else if (STARTED_AT.getTime() - req.createdAt.getTime() > RESUME_FOR_MS) await deliver(req, fraseDeFalloPorCorreo(idioma, null));
      else await startEmailRequest(req);
    } catch (err) {
      console.error(`[len-email] no se pudo retomar el correo ${req.id}`, err);
    }
  }
  if (pending.length > 0) console.info(`[len-email] ${pending.length} correo(s) a Len retomados tras el reinicio`);
  return pending.length;
}
