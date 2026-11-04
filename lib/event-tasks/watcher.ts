// THE WATCHER (spec local 2026-11-03-len-que-avisa, §7.3, §7.4, §7.10, §7.12): inside the Next process, like the
// scheduler beside it, a pass every minute. It claims the checks that are due (compare-and-swap, store.ts), and for
// each task: a paid owner and a creator who can still talk to Len there, or the task stops with one email; then the
// source is observed, the trigger decides, and the records are written. Only a candidate reaches the judge, within
// its daily limit. One task's failure never stops the others. With the server stopped nothing runs; on boot each
// task compares once what is there with what it saved, and a candidate whose judge never finished is judged once.
// A task's judges run one after another (spec §7.4: one queue per task), each with the task as saved then; a
// delivery — the cursor, its records and the judge slot — commits at once or not at all.
import "server-only";

import type { Plan } from "@/lib/plan";

import type { EventTaskRecordRow, EventTaskRow } from "./store";
import type * as store from "./store";
import type { EventSource, Condition } from "./sources/types";
import { SourceError } from "./sources/types";
import { evaluate } from "./trigger";

const TICK_MS = 60_000;
const DUE_PER_TICK = 20;
/** Checks at once: each reads a backend, and the live traffic shares those pools (final review I9). */
const CHECKS_AT_ONCE = 5;
/** A pass keeps claiming while checks are due, up to this many. */
const CHECKS_PER_PASS = 200;
const HOUR_MS = 3_600_000;

export interface WatcherDeps {
  now(): Date;
  store: Pick<typeof store, "claimDueChecks" | "saveObservation" | "writeRecord" | "takeJudgeSlot" | "deactivateEventTask" | "pendingJudges" | "getEventTaskById" | "purgeOldRecords" | "markJudged">;
  /** Runs `work` in one transaction (inTransaction, lib/db). */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /** Whether the owner has credits for a judging turn: one charged at zero would be paid by nobody (review I7). */
  hasCredits(ownerId: string): Promise<boolean>;
  /** Whether a record already made its card: a restart after the notice doesn't notify twice (review I4). */
  cardOf(recordId: string): Promise<boolean>;
  sourceOf(kind: EventTaskRow["source"]): EventSource<unknown, unknown>;
  /** Whether the creator can still talk to Len in the project, and who owns it. Null: no access at all. */
  access(projectId: string, userId: string): Promise<{ canEdit: boolean; ownerId: string } | null>;
  ownerPlan(ownerId: string): Promise<Plan>;
  /** Judges a delivered record; it marks the record judged when it ends. */
  judge(record: EventTaskRecordRow, task: EventTaskRow): Promise<void>;
  notifyStopped(task: EventTaskRow, why: "plan_required" | "no_access"): Promise<void>;
}

/** The records being judged in this process: a boot pass and a tick never hand the same one twice. */
const KEY = Symbol.for("openlen.event-tasks.judging");
type Global = typeof globalThis & { [KEY]?: Set<string> };
const judging = (): Set<string> => ((globalThis as Global)[KEY] ??= new Set());

/** Each task's queue of judges in this process: the last one handed, which the next waits for. */
const QUEUES = Symbol.for("openlen.event-tasks.queues");
type Queues = typeof globalThis & { [QUEUES]?: Map<string, Promise<void>> };
const queues = (): Map<string, Promise<void>> => ((globalThis as Queues)[QUEUES] ??= new Map());

/** For tests. */
export function forgetJudging(): void {
  judging().clear();
  queues().clear();
}

/** Hands a record to its task's queue (final review I3): a judge starts when the task's previous one ended, with
 *  the task as saved then — its conversation, its decisions. Resolves once this one started, or was skipped. */
async function hand(record: EventTaskRecordRow, task: EventTaskRow, deps: WatcherDeps): Promise<void> {
  if (judging().has(record.id)) return;
  judging().add(record.id);
  const previous = queues().get(task.id);
  let started!: () => void;
  const start = new Promise<void>((resolve) => (started = resolve));
  const turn = (previous ?? Promise.resolve()).then(async () => {
    try {
      const fresh = await deps.store.getEventTaskById(task.id);
      started();
      if (fresh?.status === "active") await deps.judge(record, fresh);
    } catch (err) {
      started();
      console.error(`[event-tasks] the judge of record ${record.id} failed`, err);
    } finally {
      judging().delete(record.id);
    }
  });
  queues().set(task.id, turn);
  void turn.finally(() => {
    if (queues().get(task.id) === turn) queues().delete(task.id);
  });
  // The first of a queue is waited for until it starts; a later one waits its turn without holding the pass.
  if (!previous) await start;
}

/** The task's day, YYYY-MM-DD in its zone: the daily judge limit counts it. */
export function dayOf(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

async function refusal(task: EventTaskRow, deps: WatcherDeps): Promise<{ refused: "plan_required" | "no_access" } | { refused: null; ownerId: string }> {
  const access = await deps.access(task.projectId, task.createdBy);
  if (!access?.canEdit) return { refused: "no_access" };
  return (await deps.ownerPlan(access.ownerId)) === "free" ? { refused: "plan_required" } : { refused: null, ownerId: access.ownerId };
}

async function check(task: EventTaskRow, deps: WatcherDeps): Promise<void> {
  const now = deps.now();
  const access = await refusal(task, deps);
  if (access.refused) {
    await deps.store.deactivateEventTask(task.id, now);
    await deps.notifyStopped(task, access.refused);
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
  const conditions = ((task.params as { conditions?: Condition[] }).conditions ?? []) as Condition[];
  const { candidate, filtered } = evaluate({ changes: observation.changes, conditions });
  // Before the transaction: a read of the owner's balance, never part of what commits.
  const credited = candidate ? await deps.hasCredits(access.ownerId) : false;
  // The cursor moves only with what it passed written down (final review I6): all of it commits, or none.
  const record = await deps.transaction(async () => {
    await deps.store.saveObservation(task.id, observation.state as Record<string, unknown>, now);
    const byReason = new Map<string, number>();
    for (const f of filtered) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
    for (const [reason, count] of byReason) await deps.store.writeRecord({ taskId: task.id, projectId: task.projectId, kind: "filtered", reason, count, at: now });
    if (!candidate) return null;
    const withheld = !credited ? "no_credits" : !(await deps.store.takeJudgeSlot(task.id, dayOf(now, task.timeZone))) ? "daily_limit" : null;
    if (withheld) {
      await deps.store.writeRecord({ taskId: task.id, projectId: task.projectId, kind: "filtered", reason: withheld, count: candidate.changes.length, at: now });
      return null;
    }
    return deps.store.writeRecord({
      taskId: task.id,
      projectId: task.projectId,
      kind: "delivered",
      candidate: candidate as unknown as Record<string, unknown>,
      count: candidate.changes.length,
      at: now,
    });
  });
  if (record) await hand(record, task, deps);
}

/** One pass: claims what is due and checks it, a few at a time, claiming again while there is more. */
export async function tick(deps: WatcherDeps): Promise<void> {
  let checked = 0;
  while (checked < CHECKS_PER_PASS) {
    const due = await deps.store.claimDueChecks(deps.now(), DUE_PER_TICK);
    for (let i = 0; i < due.length; i += CHECKS_AT_ONCE) {
      await Promise.all(
        due.slice(i, i + CHECKS_AT_ONCE).map(async (task) => {
          try {
            await check(task, deps);
          } catch (err) {
            console.error(`[event-tasks] task ${task.id} failed its check`, err);
          }
        }),
      );
    }
    checked += due.length;
    if (due.length < DUE_PER_TICK) return;
  }
}

/** On boot: candidates delivered before the restart whose judge never finished. Never throws. */
export async function resumePendingJudges(deps: WatcherDeps): Promise<void> {
  for (const record of await deps.store.pendingJudges()) {
    try {
      // Its card was made before the restart cut the judge: it was judged, and noticed (final review I4).
      if (await deps.cardOf(record.id)) {
        await deps.store.markJudged(record.id, true);
        continue;
      }
      const task = await deps.store.getEventTaskById(record.taskId);
      if (task?.status === "active") await hand(record, task, deps);
    } catch (err) {
      console.error(`[event-tasks] record ${record.id} could not be judged again`, err);
    }
  }
}

let running: { stop(): void } | null = null;

/** What runs a candidate's judge: `judgeCandidate` (./judge.ts), handed in by instrumentation.ts. */
export type JudgeRunner = (record: EventTaskRecordRow, task: EventTaskRow) => Promise<unknown>;

async function defaultDeps(judgeCandidate: JudgeRunner): Promise<WatcherDeps> {
  const [storeModule, { sourceOf }, { accesoAlProyecto, puede }, { getUserPlan }, { notifyEventTaskStopped }, { inTransaction }, { getCreditState }, { cardOfRecord }] = await Promise.all([
    import("./store"),
    import("./sources"),
    import("@/lib/projects/acceso"),
    import("@/lib/limits"),
    import("./stopped"),
    import("@/lib/db"),
    import("@/lib/credits"),
    import("./cards"),
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
    transaction: (work) => inTransaction(work),
    hasCredits: async (ownerId) => (await getCreditState(ownerId)).balance > 0,
    cardOf: async (recordId) => (await cardOfRecord(recordId)) !== null,
    judge: async (record, task) => {
      await judgeCandidate(record, task);
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
