// DELIVERING A SCHEDULED TASK (spec local 2026-10-29-tareas-programadas, §7.6–7.7). Neither DeepSeek
// nor Claude Code tell anyone outside the session; OpenLen emails whoever created the task: Len's
// reply, the files Len presented attached (what does not fit, linked), what waits for them in OpenLen
// (a question, the publish card…), and «Quitar esta tarea». The reply is SAVED before the email goes
// and marked after, like Len by email (lib/len-email/run.ts): a failed send is resent, never re-run.
// Then the push, to the same person. A task that could not be done gets the same email with the reason.
import "server-only";

import { avisoDelTurno } from "@/lib/agent/aviso-del-turno";
import { waitingFrom } from "./waiting";
import { MAX_ATTACHMENT_BYTES, presentedAttachments } from "@/lib/agent/skills/present-attachments";
import type { Tarjetas } from "@/lib/agent/turnos-desde-el-servidor";
import type { ScheduledRunOutcome } from "@/lib/db/schema";
import type { LenTurnoEvent } from "@/lib/notifications/types";
import { idiomaDelCorreo, type DatosDeLaTareaProgramada, type IdiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";
import type { markRun, RunRow, TaskRow } from "./store";

/** What one email carries (lib/agent/skills/present-attachments.ts, shared with Len's reply by email). */
export { MAX_ATTACHMENT_BYTES };

export interface ScheduledEmail extends DatosDeLaTareaProgramada {
  readonly to: string;
  readonly replyTo: string | null;
  readonly idioma: IdiomaDelCorreo;
  readonly attachments: readonly { filename: string; content: Buffer }[];
  /** Resend's idempotency key for this run's email: a refusal throws and the run is retried after a restart
   *  (`resumeAfterRestart`), and an email that did go out is not sent twice (lib/email.ts adds its digest). */
  readonly idempotencyKey?: string;
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
  /** The agent a task belongs to (spec local 2026-11-19-agentes-para-todos, §6.4), or null if it is gone. */
  agentOf(assistantId: string): Promise<{ id: string; name: string; slug: string } | null>;
  /** Its place: where its email sends the person to answer. */
  agentUrl(locale: string, slug: string): string;
}

/** The agent whose task it is; null for Len's and for one that was deleted (its email is neither Len's nor hers);
 *  "unknown" when looking her up failed — never read as deleted. */
type Agent = { id: string; name: string; slug: string } | null | "unknown";

async function agentOfTask(task: TaskRow, deps: DeliverDeps): Promise<Agent> {
  return task.assistantId ? deps.agentOf(task.assistantId).catch((): "unknown" => "unknown") : null;
}

const known = (agent: Agent) => (agent === "unknown" ? null : agent);

/** What waits for the person: one rule with the phone's «Tareas» (`./waiting.ts`). */
export { waitingFrom };

function zoneOf(task: TaskRow): string {
  return "timeZone" in task.record ? task.record.timeZone : task.timeZone;
}

async function emailOf(run: RunRow, task: TaskRow, texto: string, waiting: readonly string[], attachments: ScheduledEmail["attachments"], deps: DeliverDeps, lookup: Agent, kind: "result" | "failure"): Promise<ScheduledEmail | null> {
  const to = await deps.recipientEmail(task.createdBy);
  if (!to) return null;
  // An agent's email has no Reply-To: the space's Len address would start a Len turn, not the agent's. Nor has the email
  // of one that was deleted, which says so in no one's name (delivery 3's M1) — and her task went with her, so there is
  // nothing to remove.
  const agentGone = Boolean(task.assistantId) && lookup === null;
  const agent = known(lookup);
  const replyTo = task.assistantId ? null : deps.replyAddress(task.projectId);
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
    chatUrl: agent ? deps.agentUrl(task.locale, agent.slug) : deps.chatUrl(task.projectId),
    removeUrl: agentGone ? null : deps.removeUrl(task),
    ...(agent ? { agentName: agent.name } : {}),
    ...(agentGone ? { agentGone: true } : {}),
    idempotencyKey: `scheduled-task:${run.id}:${kind}`,
  };
}

export async function deliverResult(run: RunRow, task: TaskRow, text: string, cards: Tarjetas, deps: DeliverDeps): Promise<void> {
  await deps.markRun(run.id, { reply: text });
  const { attachments, links } = await presentedAttachments(task.projectId, cards, deps.readDelivery, deps.siteUrl);
  const texto = [text.trim(), ...(links.length > 0 ? ["", ...links] : [])].join("\n");
  const agent = await agentOfTask(task, deps);
  const email = await emailOf(run, task, texto, waitingFrom(cards), attachments, deps, agent, "result");
  if (email) await deps.send(email);
  else console.warn(`[schedule] no email for ${task.createdBy}: the result stays in the chat`);
  await deps.markRun(run.id, { emailedAt: email ? new Date() : null, outcome: "done", finishedAt: new Date() });
  await deps
    .push(avisoDelTurno({ projectId: task.projectId, userId: task.createdBy, texto: text, tarjetas: cards, ...(known(agent) ? { asistente: known(agent)! } : {}) }), `scheduled:${run.id}`)
    .catch((err: unknown) => console.warn("[schedule] push failed", err));
}

export async function deliverFailure(run: RunRow, task: TaskRow, outcome: ScheduledRunOutcome, phrase: string, deps: DeliverDeps): Promise<void> {
  await deps.markRun(run.id, { outcome, reason: phrase });
  const email = await emailOf(run, task, phrase, [], [], deps, await agentOfTask(task, deps), "failure");
  if (email) await deps.send(email);
  await deps.markRun(run.id, { emailedAt: email ? new Date() : null, finishedAt: new Date() });
}

/** The real dependencies, loaded when first used (tests inject their own). */
export async function defaultDeliverDeps(): Promise<DeliverDeps> {
  const [{ eq }, { db, schema }, store, { sendScheduledTaskEmail }, { lenEmailAddress }, { deliveryStore }, { scheduleNotification }, { urlDelChat }, { removeUrl }, { assistantById }] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("./store"),
    import("@/lib/email"),
    import("@/lib/len-email/address"),
    import("@/lib/agent/skills/deliveries"),
    import("@/lib/notifications/dispatch"),
    import("@/lib/notifications/channels/webpush"),
    import("./removal-token"),
    import("@/lib/assistants/store"),
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
    agentOf: async (assistantId) => {
      const a = await assistantById(assistantId);
      return a ? { id: a.id, name: a.name, slug: a.slug } : null;
    },
    agentUrl: (locale, slug) => `${siteUrl}/${locale}/assistant/${encodeURIComponent(slug)}`,
  };
}
