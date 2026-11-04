// The watcher (spec local 2026-11-03-len-que-avisa, §7.3, §7.4, §7.10, §7.12): every minute it claims due checks,
// observes each task's source, lets the trigger decide, writes the records and hands a candidate to the judge.
// Everything is injected: a fake store, fake sources, fake access and plan.
import { beforeEach, describe, expect, it } from "vitest";

import type { EventTaskRecordRow, EventTaskRow } from "./store";
import type { EventSource, Observation, SourceChange } from "./sources/types";
import { SourceError } from "./sources/types";
import { forgetJudging, resumePendingJudges, tick, type WatcherDeps } from "./watcher";

const NOW = new Date("2026-11-03T20:00:00Z");

function taskRow(over: Partial<EventTaskRow> = {}): EventTaskRow {
  return {
    id: "t1", projectId: "p1", createdBy: "u1", locale: "es", timeZone: "America/Mexico_City", title: "Reservas que chocan",
    prompt: "Avísame si choca.", source: "app_rows", params: { table: "reservas", created_column: "created_at", conditions: [{ field: "estado", op: "eq", value: "confirmada" }] },
    state: { cursor: { at: "a", key: "k" }, key_column: "id" }, status: "active", pausedAt: null, nextCheckAt: NOW, lastCheckedAt: null,
    judgeDay: null, judgesThatDay: 0, transcript: null, lastJudgedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

const change = (id: string, estado: string): SourceChange => ({ subject: "reservas", summary: id, detail: { id, estado }, at: "x" });

function setup(
  o: {
    tasks?: EventTaskRow[];
    observe?: (task: EventTaskRow) => Promise<Observation<unknown>>;
    plan?: string;
    canEdit?: boolean | null;
    slots?: number;
    judge?: (record: EventTaskRecordRow, task: EventTaskRow) => Promise<void>;
    credits?: boolean;
    cardOf?: (recordId: string) => boolean;
    failDelivered?: boolean;
  } = {},
) {
  const tasks = o.tasks ?? [taskRow()];
  const records: (Partial<EventTaskRecordRow> & { kind: string })[] = [];
  const saved: unknown[] = [];
  const judged: string[] = [];
  const stopped: { task: string; why: string }[] = [];
  const deactivated: string[] = [];
  const marked: { id: string; notified: boolean }[] = [];
  let slots = o.slots ?? 24;
  const source = {
    observe: (_p: string, _params: unknown, _state: unknown) => (o.observe ? o.observe(tasks[0]!) : Promise.resolve({ state: { cursor: "next" }, changes: [] })),
  } as unknown as EventSource<unknown, unknown>;
  const deps: WatcherDeps = {
    now: () => NOW,
    store: {
      claimDueChecks: async () => tasks.filter((t) => t.status === "active" && !t.pausedAt),
      saveObservation: async (_id, state) => void saved.push(state),
      writeRecord: async (r) => {
        if (o.failDelivered && r.kind === "delivered") throw new Error("the base went away");
        const row = { id: `r${records.length + 1}`, judge: r.kind === "delivered" ? "pending" : null, ...r } as unknown as EventTaskRecordRow;
        records.push(row);
        return row;
      },
      takeJudgeSlot: async () => slots-- > 0,
      deactivateEventTask: async (id) => void deactivated.push(id),
      pendingJudges: async () => records.filter((r) => r.judge === "pending") as EventTaskRecordRow[],
      getEventTaskById: async (id) => tasks.find((t) => t.id === id) ?? null,
      purgeOldRecords: async () => {},
      markJudged: async (id, notified) => void marked.push({ id, notified }),
    },
    // A fake transaction: what the work wrote is undone when it throws.
    transaction: async (work) => {
      const [savedBefore, recordsBefore] = [saved.length, records.length];
      try {
        return await work();
      } catch (err) {
        saved.length = savedBefore;
        records.length = recordsBefore;
        throw err;
      }
    },
    hasCredits: async () => o.credits ?? true,
    cardOf: async (recordId) => o.cardOf?.(recordId) ?? false,
    sourceOf: () => source,
    access: async () => (o.canEdit === null ? null : { canEdit: o.canEdit ?? true, ownerId: "owner" }),
    ownerPlan: async () => (o.plan ?? "pro") as never,
    // Like the real judge: it marks its record judged when it ends.
    judge:
      o.judge ??
      (async (record) => {
        judged.push(record.id);
        (record as { judge: string }).judge = "done";
      }),
    notifyStopped: async (task, why) => void stopped.push({ task: task.id, why }),
  };
  return { deps, records, saved, judged, stopped, deactivated, tasks, marked };
}

beforeEach(() => forgetJudging());

describe("tick", () => {
  it("an observation without changes writes no record and starts no judge", async () => {
    const s = setup();
    await tick(s.deps);
    expect(s.records).toEqual([]);
    expect(s.judged).toEqual([]);
    expect(s.saved).toEqual([{ cursor: "next" }]);
  });

  it("filtered changes write one filtered record per reason, with their count, and start no judge", async () => {
    const s = setup({ observe: async () => ({ state: {}, changes: [change("1", "pendiente"), change("2", "pendiente")] }) });
    await tick(s.deps);
    expect(s.records).toEqual([expect.objectContaining({ kind: "filtered", reason: "estado ≠ confirmada", count: 2 })]);
    expect(s.judged).toEqual([]);
  });

  it("a candidate writes one delivered record with judge pending and hands it to the judge once", async () => {
    const s = setup({ observe: async () => ({ state: {}, changes: [change("1", "confirmada"), change("2", "confirmada")] }) });
    await tick(s.deps);
    expect(s.records).toEqual([expect.objectContaining({ kind: "delivered", candidate: expect.objectContaining({ summary: "reservas: 2" }) })]);
    expect(s.judged).toEqual(["r1"]);
  });

  it("a source error writes a failed record each check, and other tasks still run", async () => {
    const tasks = [taskRow({ id: "t1" }), taskRow({ id: "t2", source: "form_submissions" })];
    let calls = 0;
    const s = setup({
      tasks,
      observe: async () => {
        calls++;
        if (calls % 2 === 1) throw new SourceError("column_missing", 'column "created_at" does not exist');
        return { state: {}, changes: [] };
      },
    });
    await tick(s.deps);
    expect(calls).toBe(2);
    expect(s.records).toEqual([expect.objectContaining({ kind: "failed", reason: "column_missing", taskId: "t1" })]);
  });

  it("the owner on Free stops the task with one notifyStopped and observes nothing", async () => {
    let observed = false;
    const s = setup({ plan: "free", observe: async () => ((observed = true), { state: {}, changes: [] }) });
    await tick(s.deps);
    expect(observed).toBe(false);
    expect(s.deactivated).toEqual(["t1"]);
    expect(s.stopped).toEqual([{ task: "t1", why: "plan_required" }]);
  });

  it("the creator without access stops the task the same way", async () => {
    const s = setup({ canEdit: false });
    await tick(s.deps);
    expect(s.stopped).toEqual([{ task: "t1", why: "no_access" }]);
  });

  it("past the daily judge limit the candidate is a filtered record daily_limit", async () => {
    const s = setup({ slots: 0, observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }) });
    await tick(s.deps);
    expect(s.records).toEqual([expect.objectContaining({ kind: "filtered", reason: "daily_limit" })]);
    expect(s.judged).toEqual([]);
  });

  it("two candidates of one task are judged one after the other, each with the task as saved then (review I3)", async () => {
    const seen: { record: string; transcript: unknown }[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => (release = r));
    const s = setup({
      observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }),
      judge: async (record, task) => {
        seen.push({ record: record.id, transcript: task.transcript });
        if (record.id === "r1") await first;
      },
    });
    await tick(s.deps);
    await tick(s.deps);
    expect(seen.map((x) => x.record)).toEqual(["r1"]);
    s.tasks[0]!.transcript = ["what the first judge saved"];
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([
      { record: "r1", transcript: null },
      { record: "r2", transcript: ["what the first judge saved"] },
    ]);
  });

  it("a delivery writes its cursor, records and slot in one transaction: a failed write loses nothing (review I6)", async () => {
    const s = setup({ failDelivered: true, observe: async () => ({ state: { cursor: "moved" }, changes: [change("1", "confirmada"), change("2", "pendiente")] }) });
    await tick(s.deps);
    expect(s.saved).toEqual([]);
    expect(s.records).toEqual([]);
    expect(s.judged).toEqual([]);
  });

  it("with the owner out of credits the candidate is a filtered record no_credits, and no judge runs (review I7)", async () => {
    let slotTaken = false;
    const s = setup({ credits: false, observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }) });
    s.deps.store.takeJudgeSlot = async () => ((slotTaken = true), true);
    await tick(s.deps);
    expect(s.records).toEqual([expect.objectContaining({ kind: "filtered", reason: "no_credits", count: 1 })]);
    expect(s.judged).toEqual([]);
    expect(slotTaken).toBe(false);
  });

  it("a tick keeps claiming while checks are due, a few at a time (review I9)", async () => {
    const all = Array.from({ length: 25 }, (_, i) => taskRow({ id: `t${i}` }));
    const s = setup({ tasks: all });
    const queue = [...all];
    let running = 0;
    let most = 0;
    s.deps.store.claimDueChecks = async (_now, limit) => queue.splice(0, limit);
    s.deps.sourceOf = () =>
      ({
        observe: async () => {
          running++;
          most = Math.max(most, running);
          await new Promise((r) => setTimeout(r, 1));
          running--;
          return { state: {}, changes: [] };
        },
      }) as unknown as EventSource<unknown, unknown>;
    await tick(s.deps);
    expect(s.saved).toHaveLength(25);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(5);
  });

  it("each pass also retries the owner's replies that are due (spec 2026-11-04-hazlo, §7.3)", async () => {
    const s = setup();
    const retried: Date[] = [];
    s.deps.retrySends = async (now) => void retried.push(now);
    await tick(s.deps);
    expect(retried).toEqual([NOW]);
  });

  it("a paused task is not claimed", async () => {
    const s = setup({ tasks: [taskRow({ pausedAt: NOW })] });
    await tick(s.deps);
    expect(s.saved).toEqual([]);
  });
});

describe("resumePendingJudges", () => {
  it("at boot, delivered records still pending are judged once", async () => {
    // The judge before the restart never finished: its record is still pending.
    const s = setup({ observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }), judge: async () => {} });
    await tick(s.deps);
    forgetJudging();
    s.deps.judge = async (record) => {
      s.judged.push(record.id);
      (record as { judge: string }).judge = "done";
    };
    await resumePendingJudges(s.deps);
    await resumePendingJudges(s.deps);
    expect(s.judged).toEqual(["r1"]);
  });

  it("a record whose card was already made before the restart is marked judged, not judged again (review I4)", async () => {
    const s = setup({ observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }), judge: async () => {} });
    await tick(s.deps);
    forgetJudging();
    const again: string[] = [];
    s.deps.judge = async (record) => void again.push(record.id);
    s.deps.cardOf = async (recordId) => recordId === "r1";
    await resumePendingJudges(s.deps);
    expect(again).toEqual([]);
    expect(s.marked).toEqual([{ id: "r1", notified: true }]);
  });

  it("each pass hands a record put back to its judge (a note, «Volver a mirar»), once", async () => {
    const s = setup();
    s.records.push({ id: "r9", taskId: "t1", kind: "delivered", judge: "pending", note: "Ofrécele la 8.", lastAt: NOW } as never);
    await tick(s.deps);
    await tick(s.deps);
    expect(s.judged).toEqual(["r9"]);
  });

  it("whether a card was already made is asked since the record was last queued, so a requeue's old card doesn't count", async () => {
    const s = setup();
    const LATER = new Date(NOW.getTime() + 60_000);
    s.records.push({ id: "r9", taskId: "t1", kind: "delivered", judge: "pending", lastAt: LATER } as never);
    const asked: [string, Date][] = [];
    s.deps.cardOf = async (recordId, since) => {
      asked.push([recordId, since]);
      return false;
    };
    await resumePendingJudges(s.deps);
    expect(asked).toEqual([["r9", LATER]]);
    expect(s.judged).toEqual(["r9"]);
  });

  it("a pending record of a deleted or inactive task is not judged", async () => {
    const s = setup({ observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }) });
    await tick(s.deps);
    forgetJudging();
    s.judged.length = 0;
    s.tasks[0]!.status = "inactive";
    await resumePendingJudges(s.deps);
    expect(s.judged).toEqual([]);
  });
});
