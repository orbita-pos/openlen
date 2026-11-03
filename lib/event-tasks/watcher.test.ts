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
    judgeDay: null, judgesThatDay: 0, transcript: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

const change = (id: string, estado: string): SourceChange => ({ subject: "reservas", summary: id, detail: { id, estado }, at: "x" });

function setup(o: { tasks?: EventTaskRow[]; observe?: (task: EventTaskRow) => Promise<Observation<unknown>>; plan?: string; canEdit?: boolean | null; slots?: number } = {}) {
  const tasks = o.tasks ?? [taskRow()];
  const records: (Partial<EventTaskRecordRow> & { kind: string })[] = [];
  const saved: unknown[] = [];
  const judged: string[] = [];
  const stopped: { task: string; why: string }[] = [];
  const deactivated: string[] = [];
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
        const row = { id: `r${records.length + 1}`, judge: r.kind === "delivered" ? "pending" : null, ...r } as unknown as EventTaskRecordRow;
        records.push(row);
        return row;
      },
      takeJudgeSlot: async () => slots-- > 0,
      deactivateEventTask: async (id) => void deactivated.push(id),
      pendingJudges: async () => records.filter((r) => r.judge === "pending") as EventTaskRecordRow[],
      getEventTaskById: async (id) => tasks.find((t) => t.id === id) ?? null,
      purgeOldRecords: async () => {},
    },
    sourceOf: () => source,
    access: async () => (o.canEdit === null ? null : { canEdit: o.canEdit ?? true, ownerId: "owner" }),
    ownerPlan: async () => (o.plan ?? "pro") as never,
    judge: (record) => void judged.push(record.id),
    notifyStopped: async (task, why) => void stopped.push({ task: task.id, why }),
  };
  return { deps, records, saved, judged, stopped, deactivated, tasks };
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

  it("a paused task is not claimed", async () => {
    const s = setup({ tasks: [taskRow({ pausedAt: NOW })] });
    await tick(s.deps);
    expect(s.saved).toEqual([]);
  });
});

describe("resumePendingJudges", () => {
  it("at boot, delivered records still pending are judged once", async () => {
    const s = setup({ observe: async () => ({ state: {}, changes: [change("1", "confirmada")] }) });
    await tick(s.deps);
    forgetJudging();
    s.judged.length = 0;
    await resumePendingJudges(s.deps);
    await resumePendingJudges(s.deps);
    expect(s.judged).toEqual(["r1"]);
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
