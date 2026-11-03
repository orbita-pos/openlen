// THE WATCHER (spec local 2026-11-03-len-que-avisa, §7.3, §7.4, §7.10, §7.12): inside the Next process, like the
// scheduler beside it, a pass every minute. It claims the checks that are due (compare-and-swap, store.ts), and for
// each task: a paid owner and a creator who can still talk to Len there, or the task stops with one email; then the
// source is observed, the trigger decides, and the records are written. Only a candidate reaches the judge, within
// its daily limit. One task's failure never stops the others. With the server stopped nothing runs; on boot each
// task compares once what is there with what it saved, and a candidate whose judge never finished is judged once.
import "server-only";

import type { Plan } from "@/lib/plan";

import type { EventTaskRecordRow, EventTaskRow } from "./store";
import type * as store from "./store";
import type { EventSource, Condition } from "./sources/types";
import { SourceError } from "./sources/types";
import { evaluate } from "./trigger";

const TICK_MS = 60_000;
const DUE_PER_TICK = 20;
const HOUR_MS = 3_600_000;

export interface WatcherDeps {
  now(): Date;
  store: Pick<typeof store, "claimDueChecks" | "saveObservation" | "writeRecord" | "takeJudgeSlot" | "deactivateEventTask" | "pendingJudges" | "getEventTaskById" | "purgeOldRecords">;
  sourceOf(kind: EventTaskRow["source"]): EventSource<unknown, unknown>;
  /** Whether the creator can still talk to Len in the project, and who owns it. Null: no access at all. */
  access(projectId: string, userId: string): Promise<{ canEdit: boolean; ownerId: string } | null>;
  ownerPlan(ownerId: string): Promise<Plan>;
  /** Starts the judge of a delivered record; it marks the record judged when it ends. */
  judge(record: EventTaskRecordRow, task: EventTaskRow): void;
  notifyStopped(task: EventTaskRow, why: "plan_required" | "no_access"): Promise<void>;
}

/** The records being judged in this process: a boot pass and a tick never hand the same one twice. */
const KEY = Symbol.for("openlen.event-tasks.judging");
type Global = typeof globalThis & { [KEY]?: Set<string> };
const judging = (): Set<string> => ((globalThis as Global)[KEY] ??= new Set());

/** For tests. */
export function forgetJudging(): void {
  judging().clear();
}

function hand(record: EventTaskRecordRow, task: EventTaskRow, deps: WatcherDeps): void {
  if (judging().has(record.id)) return;
  judging().add(record.id);
  deps.judge(record, task);
}

/** Called by the judge when it ends, ok or not. */
export function judged(recordId: string): void {
  judging().delete(recordId);
}

/** The task's day, YYYY-MM-DD in its zone: the daily judge limit counts it. */
export function dayOf(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

async function refusal(task: EventTaskRow, deps: WatcherDeps): Promise<"plan_required" | "no_access" | null> {
  const access = await deps.access(task.projectId, task.createdBy);
  if (!access?.canEdit) return "no_access";
  return (await deps.ownerPlan(access.ownerId)) === "free" ? "plan_required" : null;
}

async function check(task: EventTaskRow, deps: WatcherDeps): Promise<void> {
  const now = deps.now();
  const refused = await refusal(task, deps);
  if (refused) {
    await deps.store.deactivateEventTask(task.id, now);
    await deps.notifyStopped(task, refused);
    return;
  }
  const source = deps.sourceOf(task.source);
  let observation;
  try {
    observation = await source.observe(task.projectId, task.params, task.state);
  } catch (err) {
    const reason = err instanceof SourceError ? err.reason : "read_failed";
    if (!(err instanceof SourceError)) console.error(`[event-tasks] task ${task.id} could not observe its source`, err);
    await deps.store.writeRecord({ taskId: task.id, projectId: task.projectId, kind: "failed", reason, at: now });
    return;
  }
  await deps.store.saveObservation(task.id, observation.state as Record<string, unknown>, now);
  if (observation.changes.length === 0) return;
  const conditions = ((task.params as { conditions?: Condition[] }).conditions ?? []) as Condition[];
  const { candidate, filtered } = evaluate({ changes: observation.changes, conditions });
  const byReason = new Map<string, number>();
  for (const f of filtered) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
  for (const [reason, count] of byReason) await deps.store.writeRecord({ taskId: task.id, projectId: task.projectId, kind: "filtered", reason, count, at: now });
  if (!candidate) return;
  if (!(await deps.store.takeJudgeSlot(task.id, dayOf(now, task.timeZone)))) {
    await deps.store.writeRecord({ taskId: task.id, projectId: task.projectId, kind: "filtered", reason: "daily_limit", count: candidate.changes.length, at: now });
    return;
  }
  const record = await deps.store.writeRecord({
    taskId: task.id,
    projectId: task.projectId,
    kind: "delivered",
    candidate: candidate as unknown as Record<string, unknown>,
    count: candidate.changes.length,
    at: now,
  });
  hand(record, task, deps);
}

/** One pass: claims and checks what is due. */
export async function tick(deps: WatcherDeps): Promise<void> {
  for (const task of await deps.store.claimDueChecks(deps.now(), DUE_PER_TICK)) {
    try {
      await check(task, deps);
    } catch (err) {
      console.error(`[event-tasks] task ${task.id} failed its check`, err);
    }
  }
}

/** On boot: candidates delivered before the restart whose judge never finished. Never throws. */
export async function resumePendingJudges(deps: WatcherDeps): Promise<void> {
  for (const record of await deps.store.pendingJudges()) {
    try {
      const task = await deps.store.getEventTaskById(record.taskId);
      if (task?.status === "active") hand(record, task, deps);
    } catch (err) {
      console.error(`[event-tasks] record ${record.id} could not be judged again`, err);
    }
  }
}

let running: { stop(): void } | null = null;

/** What runs a candidate's judge: `judgeCandidate` (./judge.ts), handed in by instrumentation.ts. */
export type JudgeRunner = (record: EventTaskRecordRow, task: EventTaskRow) => Promise<unknown>;

async function defaultDeps(judgeCandidate: JudgeRunner): Promise<WatcherDeps> {
  const [storeModule, { sourceOf }, { accesoAlProyecto, puede }, { getUserPlan }, { notifyEventTaskStopped }] = await Promise.all([
    import("./store"),
    import("./sources"),
    import("@/lib/projects/acceso"),
    import("@/lib/limits"),
    import("./stopped"),
  ]);
  return {
    now: () => new Date(),
    store: storeModule,
    sourceOf,
    access: async (projectId, userId) => {
      const a = await accesoAlProyecto(projectId, userId);
      return a ? { canEdit: puede(a.rol, "editar"), ownerId: a.duenoId } : null;
    },
    ownerPlan: (ownerId) => getUserPlan(ownerId),
    judge: (record, task) => {
      void judgeCandidate(record, task)
        .catch((err: unknown) => console.error(`[event-tasks] the judge of record ${record.id} failed`, err))
        .finally(() => judged(record.id));
    },
    notifyStopped: (task, why) => notifyEventTaskStopped(task, why),
  };
}

/** Once per process, from instrumentation.ts, behind `eventTasksEnabled`. */
export function startWatcher(judgeCandidate: JudgeRunner): { stop(): void } {
  if (running) return running;
  let ticking = false;
  let lastPurge = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  void defaultDeps(judgeCandidate)
    .then(async (deps) => {
      await resumePendingJudges(deps);
      console.log(`[event-tasks] watcher on: a pass every ${TICK_MS / 1000} s`);
      const pass = async () => {
        if (ticking) return;
        ticking = true;
        try {
          await tick(deps);
          if (Date.now() - lastPurge > HOUR_MS) {
            lastPurge = Date.now();
            await deps.store.purgeOldRecords(deps.now());
          }
        } catch (err) {
          console.error("[event-tasks] tick failed", err);
        } finally {
          ticking = false;
        }
      };
      await pass();
      timer = setInterval(() => void pass(), TICK_MS);
      timer.unref?.();
    })
    .catch((err) => console.error("[event-tasks] the watcher could not start", err));
  return (running = {
    stop() {
      if (timer) clearInterval(timer);
    },
  });
}
