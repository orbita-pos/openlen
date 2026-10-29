// THE SCHEDULER (spec local 2026-10-29-tareas-programadas, §7.5, §7.9, §7.10). Inside the Next process,
// like DeepSeek's host, because the turn queue and `hayTurnoVivoEnElProyecto` live here (the systemd
// timer of the notifications is another process and cannot run turns). Postgres is the truth: every
// 30 s it claims what is due (compare-and-swap, store.ts) and only the claimer launches it, so no
// occurrence ever runs twice. A recurring task that missed several runs runs ONCE, for its latest
// occurrence (DeepSeek); a one-shot missed by more than a day is told, not run (the hilos' window).
// Before launching: the owner must be on a paid plan and the creator still able to talk to Len there;
// if not, the task stops with ONE email. After a restart, a run another process left is never repeated
// blindly: started → «cut»; reply saved but not emailed → emailed; never started → run if still recent.
import "server-only";

import { randomUUID } from "node:crypto";

import type { FalloDelTurno, launchScheduledTurn } from "@/lib/agent/turnos-desde-el-servidor";
import type { ScheduledRunOutcome } from "@/lib/db/schema";
import type { Plan } from "@/lib/plan";
import { fraseDeFalloPorCorreo, fraseDeInterrupcionPorCorreo, idiomaDelCorreo, scheduledTaskPhrase } from "@/lib/projects/correos-del-proyecto";
import type { ScheduledOrigin } from "@/lib/projects/types";
import { isRecurringScheduleRecord, renderRecurringReminderBatchFraming, renderReminderFraming, resolveRecurringOccurrence } from "./deepseek/domain";
import type { OneShotScheduleRecord } from "./deepseek/types";
import { scheduleEnabled } from "./enabled";
import type * as store from "./store";
import type { RunRow, TaskRow } from "./store";

const TICK_MS = 30_000;
const DAY_MS = 86_400_000;
/** Past this, a one-shot that never ran is told, not run (it would surprise): the hilos' window. */
const ONE_SHOT_GRACE_MS = DAY_MS;
const DUE_PER_TICK = 20;

export interface SchedulerDeps {
  now(): Date;
  /** When this process started: a run claimed before it belongs to a process that is gone. */
  processStartedAt: Date;
  newRunId(): string;
  store: Pick<typeof store, "dueTasks" | "claimDue" | "markRun" | "deactivateTask" | "unfinishedRuns" | "purgeOld" | "taskOfRun">;
  /** Whether the creator can still talk to Len in the project, and who owns it. Null: no access at all. */
  access(projectId: string, userId: string): Promise<{ canEdit: boolean; ownerId: string } | null>;
  ownerPlan(ownerId: string): Promise<Plan>;
  launch: typeof launchScheduledTurn;
  deliverResult(run: RunRow, task: TaskRow, text: string, cards: Parameters<Parameters<typeof launchScheduledTurn>[0]["reply"]>[1]): Promise<void>;
  deliverFailure(run: RunRow, task: TaskRow, outcome: ScheduledRunOutcome, phrase: string): Promise<void>;
}

function zoneOf(task: TaskRow): string {
  return "timeZone" in task.record ? task.record.timeZone : task.timeZone;
}

function outcomeOf(fallo: FalloDelTurno | null): ScheduledRunOutcome {
  if (fallo?.code === "no_credits") return "no_credits";
  if (fallo?.code === "tope_de_miembros") return "member_cap";
  return "failed";
}

/** Launches a claimed run: DeepSeek's framing for the model, the prompt for the chat row. */
function launchRun(run: RunRow, task: TaskRow, deps: SchedulerDeps): void {
  const occurrenceAt = run.occurrenceAt.toISOString();
  const record = task.record;
  const framing = isRecurringScheduleRecord(record)
    ? renderRecurringReminderBatchFraming([{ record, occurrenceAt }])
    : renderReminderFraming({ ...record, scheduledAt: occurrenceAt } as OneShotScheduleRecord);
  const origin: ScheduledOrigin = { kind: "scheduled", taskId: task.id, title: record.title, occurrenceAt };
  const idioma = idiomaDelCorreo(task.locale);
  deps.launch({
    userId: task.createdBy,
    projectId: task.projectId,
    texto: record.prompt,
    framing,
    origin,
    timeZone: zoneOf(task),
    locale: task.locale,
    filaId: run.id,
    onStart: () => deps.store.markRun(run.id, { startedAt: deps.now() }),
    reply: (text, cards) => deps.deliverResult(run, task, text, cards),
    fail: (fallo, cut) =>
      deps.deliverFailure(run, task, cut ? "cut" : outcomeOf(fallo), cut ? fraseDeInterrupcionPorCorreo(idioma) : fraseDeFalloPorCorreo(idioma, fallo)),
  });
}

/** Before launching: a paid owner and a creator who can still talk to Len there. */
async function refusal(task: TaskRow, deps: SchedulerDeps): Promise<"plan_required" | "no_access" | null> {
  const access = await deps.access(task.projectId, task.createdBy);
  if (!access?.canEdit) return "no_access";
  return (await deps.ownerPlan(access.ownerId)) === "free" ? "plan_required" : null;
}

async function tell(run: RunRow, task: TaskRow, why: "plan_required" | "no_access" | "missed", deps: SchedulerDeps): Promise<void> {
  await deps.deliverFailure(run, task, why, scheduledTaskPhrase(idiomaDelCorreo(task.locale), why));
}

/** One pass: claims and launches what is due. Returns how many it launched. */
export async function tick(deps: SchedulerDeps): Promise<number> {
  const now = deps.now();
  let launched = 0;
  for (const task of await deps.store.dueTasks(now, DUE_PER_TICK)) {
    try {
      const record = task.record;
      const recurring = isRecurringScheduleRecord(record);
      const occurrence = isRecurringScheduleRecord(record)
        ? resolveRecurringOccurrence(record, now.getTime())
        : { occurrenceAt: task.scheduledAt.toISOString(), nextScheduledAt: undefined };
      const run = await deps.store.claimDue(task, {
        occurrenceAt: occurrence.occurrenceAt,
        nextScheduledAt: occurrence.nextScheduledAt ?? null,
        runId: deps.newRunId(),
        processStartedAt: deps.processStartedAt,
      });
      if (!run) continue;
      if (!recurring && now.getTime() - run.occurrenceAt.getTime() > ONE_SHOT_GRACE_MS) {
        await tell(run, task, "missed", deps);
        continue;
      }
      const refused = await refusal(task, deps);
      if (refused) {
        await deps.store.deactivateTask(task.id);
        await tell(run, task, refused, deps);
        continue;
      }
      launchRun(run, task, deps);
      launched++;
    } catch (err) {
      console.error(`[schedule] task ${task.id} failed to start`, err);
    }
  }
  return launched;
}

/** What another process left half done. Never throws. */
export async function resumeAfterRestart(deps: SchedulerDeps): Promise<void> {
  const now = deps.now();
  for (const run of await deps.store.unfinishedRuns()) {
    if (run.processStartedAt.getTime() >= deps.processStartedAt.getTime()) continue;
    try {
      const task = await deps.store.taskOfRun(run);
      if (!task) {
        await deps.store.markRun(run.id, { finishedAt: now });
        continue;
      }
      const idioma = idiomaDelCorreo(task.locale);
      if (run.reply !== null) await deps.deliverResult(run, task, run.reply, []);
      else if (run.outcome !== null) await deps.deliverFailure(run, task, run.outcome, run.reason ?? fraseDeFalloPorCorreo(idioma, null));
      else if (run.startedAt) await deps.deliverFailure(run, task, "cut", fraseDeInterrupcionPorCorreo(idioma));
      else if (now.getTime() - run.occurrenceAt.getTime() <= ONE_SHOT_GRACE_MS) launchRun(run, task, deps);
      else await tell(run, task, "missed", deps);
    } catch (err) {
      console.error(`[schedule] run ${run.id} could not be resumed`, err);
    }
  }
}

const PROCESS_STARTED_AT = new Date();
let running: { stop(): void } | null = null;

async function defaultDeps(): Promise<SchedulerDeps> {
  const [store, { accesoAlProyecto, puede }, { getUserPlan }, { launchScheduledTurn }, deliver] = await Promise.all([
    import("./store"),
    import("@/lib/projects/acceso"),
    import("@/lib/limits"),
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("./deliver"),
  ]);
  const deliverDeps = await deliver.defaultDeliverDeps();
  return {
    now: () => new Date(),
    processStartedAt: PROCESS_STARTED_AT,
    newRunId: () => randomUUID(),
    store,
    access: async (projectId, userId) => {
      const a = await accesoAlProyecto(projectId, userId);
      return a ? { canEdit: puede(a.rol, "editar"), ownerId: a.duenoId } : null;
    },
    ownerPlan: (ownerId) => getUserPlan(ownerId),
    launch: launchScheduledTurn,
    deliverResult: (run, task, text, cards) => deliver.deliverResult(run, task, text, cards, deliverDeps),
    deliverFailure: (run, task, outcome, phrase) => deliver.deliverFailure(run, task, outcome, phrase, deliverDeps),
  };
}

/** Once per process, from instrumentation.ts. With OPENLEN_SCHEDULE=0 it does nothing. */
export function startScheduler(): { stop(): void } {
  if (running) return running;
  if (!scheduleEnabled()) return (running = { stop() {} });
  let ticking = false;
  let lastPurge = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  void defaultDeps()
    .then(async (deps) => {
      await resumeAfterRestart(deps);
      console.log(`[schedule] scheduler on: a pass every ${TICK_MS / 1000} s`);
      const pass = async () => {
        if (ticking) return;
        ticking = true;
        try {
          const launched = await tick(deps);
          if (launched > 0) console.log(`[schedule] launched ${launched} scheduled task(s)`);
          if (Date.now() - lastPurge > DAY_MS) {
            lastPurge = Date.now();
            await deps.store.purgeOld(deps.now());
          }
        } catch (err) {
          console.error("[schedule] tick failed", err);
        } finally {
          ticking = false;
        }
      };
      await pass();
      timer = setInterval(() => void pass(), TICK_MS);
      timer.unref?.();
    })
    .catch((err) => console.error("[schedule] the scheduler could not start", err));
  return (running = {
    stop() {
      if (timer) clearInterval(timer);
    },
  });
}
