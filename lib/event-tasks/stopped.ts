// An event task that stopped (spec local 2026-11-03-len-que-avisa, §7.10): the owner went to Free, or its creator
// can no longer talk to Len there. ONE email, the scheduled tasks' own, with their phrase — the same road a time
// task takes when it stops for the same reason.
import "server-only";

import type { EventTaskRow } from "./store";

export async function notifyEventTaskStopped(task: EventTaskRow, why: "plan_required" | "no_access"): Promise<void> {
  const [{ defaultDeliverDeps }, { idiomaDelCorreo, scheduledTaskPhrase }] = await Promise.all([import("@/lib/scheduled-tasks/deliver"), import("@/lib/projects/correos-del-proyecto")]);
  const deps = await defaultDeliverDeps();
  const to = await deps.recipientEmail(task.createdBy);
  if (!to) return;
  const idioma = idiomaDelCorreo(task.locale);
  await deps.send({
    to,
    replyTo: null,
    idioma,
    attachments: [],
    projectTitle: await deps.projectTitle(task.projectId),
    title: task.title,
    occurrenceAt: new Date().toISOString(),
    timeZone: task.timeZone,
    texto: scheduledTaskPhrase(idioma, why),
    waiting: [],
    canReply: false,
    chatUrl: deps.chatUrl(task.projectId),
    removeUrl: null,
  });
}
