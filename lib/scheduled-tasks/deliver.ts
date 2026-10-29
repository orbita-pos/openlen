// DELIVERING A SCHEDULED TASK (spec local 2026-10-29-tareas-programadas, §7.6–7.7). Neither DeepSeek
// nor Claude Code tell anyone outside the session; OpenLen emails whoever created the task: Len's
// reply, the files Len presented attached (what does not fit, linked), what waits for them in OpenLen
// (a question, the publish card…), and «Quitar esta tarea». The reply is SAVED before the email goes
// and marked after, like Len by email (lib/len-email/run.ts): a failed send is resent, never re-run.
// Then the push, to the same person. A task that could not be done gets the same email with the reason.
import "server-only";

import { avisoDelTurno } from "@/lib/agent/aviso-del-turno";
import { asksTheOwner } from "@/lib/agent/ask-user-question";
import { deliveredFrom, type DeliveredFile } from "@/lib/agent/skills/present";
import type { Tarjetas } from "@/lib/agent/turnos-desde-el-servidor";
import type { ScheduledRunOutcome } from "@/lib/db/schema";
import type { LenTurnoEvent } from "@/lib/notifications/types";
import { idiomaDelCorreo, type DatosDeLaTareaProgramada, type IdiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";
import type { markRun, RunRow, TaskRow } from "./store";

/** What one email carries, like `present`'s cap on one file. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface ScheduledEmail extends DatosDeLaTareaProgramada {
  readonly to: string;
  readonly replyTo: string | null;
  readonly idioma: IdiomaDelCorreo;
  readonly attachments: readonly { filename: string; content: Buffer }[];
}

export interface DeliverDeps {
  markRun: typeof markRun;
  recipientEmail(userId: string): Promise<string | null>;
  projectTitle(projectId: string): Promise<string>;
  /** The project's Len address (lib/len-email), or null when that is off. */
  replyAddress(projectId: string): string | null;
  readDelivery(key: string): Promise<Uint8Array | null>;
  send(email: ScheduledEmail): Promise<void>;
  push(event: LenTurnoEvent, dedupeKey: string): Promise<void>;
  siteUrl: string;
  chatUrl(projectId: string): string;
  removeUrl(task: TaskRow): string | null;
}

/** Cards that leave the turn waiting for the person, beyond a question: their summary says what. */
const WAITS_FOR_THE_PERSON = new Set(["publish", "exit_plan_mode", "request_secrets", "connect_email_domain"]);

/** What waits for the person in OpenLen: unanswered questions, and the cards above. */
export function waitingFrom(cards: Tarjetas): string[] {
  const out: string[] = [];
  for (const card of cards) {
    if (asksTheOwner(card.tool) && !card.respuesta) {
      const questions = (card.preguntas ?? []).map((p) => p.question).filter(Boolean);
      out.push(...(questions.length > 0 ? questions : [card.pregunta ?? card.summary]));
    } else if (WAITS_FOR_THE_PERSON.has(card.tool)) {
      out.push(card.summary);
    }
  }
  return [...new Set(out.map((s) => s?.trim()).filter((s): s is string => Boolean(s)))];
}

/** The private-store key behind a delivered file's URL (`deliverableLocation` in present.ts). */
function deliveryKey(projectId: string, url: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/deliveries\/([^/]+)\/([^/]+)$/.exec(url);
  if (!m || decodeURIComponent(m[1]!) !== projectId) return null;
  return `deliveries/${projectId}/${m[2]}/${decodeURIComponent(m[3]!)}`;
}

function zoneOf(task: TaskRow): string {
  return "timeZone" in task.record ? task.record.timeZone : task.timeZone;
}

async function emailOf(run: RunRow, task: TaskRow, texto: string, waiting: readonly string[], attachments: ScheduledEmail["attachments"], deps: DeliverDeps): Promise<ScheduledEmail | null> {
  const to = await deps.recipientEmail(task.createdBy);
  if (!to) return null;
  const replyTo = deps.replyAddress(task.projectId);
  return {
    to,
    replyTo,
    idioma: idiomaDelCorreo(task.locale),
    attachments,
    projectTitle: await deps.projectTitle(task.projectId),
    title: task.record.title,
    occurrenceAt: run.occurrenceAt.toISOString(),
    timeZone: zoneOf(task),
    texto,
    waiting,
    canReply: replyTo !== null,
    chatUrl: deps.chatUrl(task.projectId),
    removeUrl: deps.removeUrl(task),
  };
}

export async function deliverResult(run: RunRow, task: TaskRow, text: string, cards: Tarjetas, deps: DeliverDeps): Promise<void> {
  await deps.markRun(run.id, { reply: text });
  const files: DeliveredFile[] = cards.filter((c) => c.tool === "present").flatMap((c) => deliveredFrom(c.delivered) ?? []);
  const attachments: { filename: string; content: Buffer }[] = [];
  const links: string[] = [];
  let total = 0;
  for (const file of files) {
    const key = deliveryKey(task.projectId, file.url);
    const bytes = key && total + file.size <= MAX_ATTACHMENT_BYTES ? await deps.readDelivery(key) : null;
    if (bytes && total + bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
      attachments.push({ filename: file.name, content: Buffer.from(bytes) });
      total += bytes.byteLength;
    } else {
      links.push(`${file.name}: ${deps.siteUrl}${file.url}`);
    }
  }
  const texto = [text.trim(), ...(links.length > 0 ? ["", ...links] : [])].join("\n");
  const email = await emailOf(run, task, texto, waitingFrom(cards), attachments, deps);
  if (email) await deps.send(email);
  else console.warn(`[schedule] no email for ${task.createdBy}: the result stays in the chat`);
  await deps.markRun(run.id, { emailedAt: email ? new Date() : null, outcome: "done", finishedAt: new Date() });
  await deps
    .push(avisoDelTurno({ projectId: task.projectId, userId: task.createdBy, texto: text, tarjetas: cards }), `scheduled:${run.id}`)
    .catch((err: unknown) => console.warn("[schedule] push failed", err));
}

export async function deliverFailure(run: RunRow, task: TaskRow, outcome: ScheduledRunOutcome, phrase: string, deps: DeliverDeps): Promise<void> {
  await deps.markRun(run.id, { outcome, reason: phrase });
  const email = await emailOf(run, task, phrase, [], [], deps);
  if (email) await deps.send(email);
  await deps.markRun(run.id, { emailedAt: email ? new Date() : null, finishedAt: new Date() });
}

/** The real dependencies, loaded when first used (tests inject their own). */
export async function defaultDeliverDeps(): Promise<DeliverDeps> {
  const [{ eq }, { db, schema }, store, { sendScheduledTaskEmail }, { lenEmailAddress }, { deliveryStore }, { scheduleNotification }, { urlDelChat }, { removeUrl }] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("./store"),
    import("@/lib/email"),
    import("@/lib/len-email/address"),
    import("@/lib/agent/skills/deliveries"),
    import("@/lib/notifications/dispatch"),
    import("@/lib/notifications/channels/webpush"),
    import("./removal-token"),
  ]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
  return {
    markRun: store.markRun,
    recipientEmail: async (userId) => {
      const [row] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      return row?.email ?? null;
    },
    projectTitle: async (projectId) => {
      const [row] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      return row?.title ?? "";
    },
    replyAddress: (projectId) => lenEmailAddress(projectId),
    readDelivery: async (key) => (await deliveryStore()?.get(key)) ?? null,
    send: (email) => sendScheduledTaskEmail(email),
    push: (event, dedupeKey) => scheduleNotification(event, dedupeKey),
    siteUrl,
    chatUrl: (projectId) => siteUrl + urlDelChat(projectId),
    removeUrl: (task) => removeUrl({ siteUrl, locale: task.locale, taskId: task.id }),
  };
}
