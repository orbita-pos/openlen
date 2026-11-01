// THE SCHEDULER (spec local 2026-10-29-tareas-programadas, §7.5, §7.9, §7.10): what is due runs once,
// a missed week runs only its latest occurrence, a missed one-shot past a day is told, not run; Free
// and lost access stop the task with ONE email; a deploy mid-run is told, never repeated.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));

import { ScheduleId, createAtScheduleRecord, createWeeklyScheduleRecord } from "./deepseek/domain";
import type { ScheduleRecord } from "./deepseek/types";
import type { RunRow, TaskRow } from "./store";
import { resumeAfterRestart, tick, type SchedulerDeps } from "./scheduler";

const CREATED = Date.parse("2026-10-01T12:00:00Z");
const weekly = () => createWeeklyScheduleRecord(ScheduleId("w"), "Make the PDF", { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1] }, CREATED, "PDF de resultados");

function memory(records: ScheduleRecord[]) {
  const tasks = new Map<string, TaskRow>();
  for (const record of records) {
    tasks.set(record.id, {
      id: record.id, projectId: "p1", createdBy: "member", locale: "es", timeZone: "America/Mexico_City", record,
      scheduledAt: new Date(record.scheduledAt), status: "active", pausedAt: null, lastRunId: null, createdAt: new Date(CREATED), updatedAt: new Date(CREATED),
    });
  }
  const runs = new Map<string, RunRow>();
  const store: SchedulerDeps["store"] = {
    dueTasks: async (now) => [...tasks.values()].filter((t) => t.status === "active" && t.scheduledAt <= now).map((t) => ({ ...t })),
    claimDue: async (task, claim) => {
      const cur = tasks.get(task.id);
      if (!cur || cur.status !== "active" || cur.scheduledAt.getTime() !== task.scheduledAt.getTime()) return null;
      tasks.set(task.id, claim.nextScheduledAt
        ? { ...cur, record: { ...cur.record, scheduledAt: claim.nextScheduledAt } as ScheduleRecord, scheduledAt: new Date(claim.nextScheduledAt), lastRunId: claim.runId }
        : { ...cur, status: "inactive", lastRunId: claim.runId });
      const run = { id: claim.runId, taskId: task.id, projectId: task.projectId, occurrenceAt: new Date(claim.occurrenceAt), claimedAt: new Date(), processStartedAt: claim.processStartedAt, startedAt: null, finishedAt: null, outcome: null, reason: null, reply: null, emailedAt: null } as RunRow;
      runs.set(run.id, run);
      return run;
    },
    markRun: async (id, patch) => void runs.set(id, { ...runs.get(id)!, ...patch }),
    deactivateTask: async (id) => void tasks.set(id, { ...tasks.get(id)!, status: "inactive" }),
    unfinishedRuns: async () => [...runs.values()].filter((r) => !r.finishedAt),
    purgeOld: async () => {},
    taskOfRun: async (run) => tasks.get(run.taskId) ?? null,
  };
  return { tasks, runs, store };
}

function deps(over: Partial<SchedulerDeps> & { store: SchedulerDeps["store"] }, now: string) {
  let n = 0;
  const d: SchedulerDeps = {
    now: () => new Date(now),
    processStartedAt: new Date("2026-11-02T00:00:00Z"),
    newRunId: () => `run-${++n}`,
    access: vi.fn(async () => ({ canEdit: true, ownerId: "owner" })),
    ownerPlan: vi.fn(async () => "pro" as const),
    launch: vi.fn(),
    deliverResult: vi.fn(async () => {}),
    deliverFailure: vi.fn(async () => {}),
    ...over,
  };
  return d;
}

describe("tick", () => {
  it("launches a due task as its creator, with DeepSeek's batch framing, and moves it to next week", async () => {
    const m = memory([weekly()]);
    const d = deps({ store: m.store }, "2026-11-02T15:04:00Z");
    // The first Monday after creation is 2026-10-05; jump to a later due one:
    m.tasks.set("w", { ...m.tasks.get("w")!, scheduledAt: new Date("2026-11-02T15:03:00Z"), record: { ...m.tasks.get("w")!.record, scheduledAt: "2026-11-02T15:03:00.000Z" } as ScheduleRecord });
    expect(await tick(d)).toBe(1);
    const call = vi.mocked(d.launch).mock.calls[0]![0];
    expect(call).toMatchObject({ userId: "member", projectId: "p1", texto: "Make the PDF", timeZone: "America/Mexico_City", locale: "es", filaId: "run-1" });
    expect(call.framing.startsWith("[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ")).toBe(true);
    expect(call.origin).toEqual({ kind: "scheduled", taskId: "w", title: "PDF de resultados", occurrenceAt: "2026-11-02T15:03:00.000Z" });
    expect(m.tasks.get("w")!.scheduledAt.toISOString()).toBe("2026-11-09T15:03:00.000Z");
  });

  it("two passes at once launch it once", async () => {
    const m = memory([weekly()]);
    m.tasks.set("w", { ...m.tasks.get("w")!, scheduledAt: new Date("2026-11-02T15:03:00Z"), record: { ...m.tasks.get("w")!.record, scheduledAt: "2026-11-02T15:03:00.000Z" } as ScheduleRecord });
    const d = deps({ store: m.store }, "2026-11-02T15:04:00Z");
    await Promise.all([tick(d), tick(d)]);
    expect(d.launch).toHaveBeenCalledTimes(1);
  });

  it("after three missed Mondays, runs once for the latest and schedules the next", async () => {
    const m = memory([weekly()]);
    m.tasks.set("w", { ...m.tasks.get("w")!, scheduledAt: new Date("2026-10-12T15:03:00Z"), record: { ...m.tasks.get("w")!.record, scheduledAt: "2026-10-12T15:03:00.000Z" } as ScheduleRecord });
    const d = deps({ store: m.store }, "2026-11-01T12:00:00Z");
    await tick(d);
    expect(d.launch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.launch).mock.calls[0]![0].origin.occurrenceAt).toBe("2026-10-26T15:03:00.000Z");
    expect(m.tasks.get("w")!.scheduledAt.toISOString()).toBe("2026-11-02T15:03:00.000Z");
  });

  it("a one-shot missed by more than a day is told, not run", async () => {
    const at = createAtScheduleRecord(ScheduleId("o"), "Do it", "2026-10-30T09:00:00-06:00", CREATED, "Una vez");
    const m = memory([at]);
    const d = deps({ store: m.store }, "2026-11-01T12:00:00Z");
    await tick(d);
    expect(d.launch).not.toHaveBeenCalled();
    expect(d.deliverFailure).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1" }), expect.objectContaining({ id: "o" }), "missed", expect.any(String));
    expect(m.tasks.get("o")!.status).toBe("inactive");
  });

  it("an owner on Free stops the task with one email, and next week nothing", async () => {
    const m = memory([weekly()]);
    m.tasks.set("w", { ...m.tasks.get("w")!, scheduledAt: new Date("2026-11-02T15:03:00Z"), record: { ...m.tasks.get("w")!.record, scheduledAt: "2026-11-02T15:03:00.000Z" } as ScheduleRecord });
    const d = deps({ store: m.store, ownerPlan: vi.fn(async () => "free" as const) }, "2026-11-02T15:04:00Z");
    await tick(d);
    expect(d.launch).not.toHaveBeenCalled();
    expect(d.deliverFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.deliverFailure).mock.calls[0]![2]).toBe("plan_required");
    expect(m.tasks.get("w")!.status).toBe("inactive");
    const later = deps({ store: m.store, ownerPlan: vi.fn(async () => "free" as const) }, "2026-11-09T15:04:00Z");
    await tick(later);
    expect(later.deliverFailure).not.toHaveBeenCalled();
  });

  it("a creator who can no longer edit stops the task with one email", async () => {
    const m = memory([weekly()]);
    m.tasks.set("w", { ...m.tasks.get("w")!, scheduledAt: new Date("2026-11-02T15:03:00Z"), record: { ...m.tasks.get("w")!.record, scheduledAt: "2026-11-02T15:03:00.000Z" } as ScheduleRecord });
    const d = deps({ store: m.store, access: vi.fn(async () => ({ canEdit: false, ownerId: "owner" })) }, "2026-11-02T15:04:00Z");
    await tick(d);
    expect(d.launch).not.toHaveBeenCalled();
    expect(vi.mocked(d.deliverFailure).mock.calls[0]![2]).toBe("no_access");
    expect(m.tasks.get("w")!.status).toBe("inactive");
  });

  it("the launched run reports its failure with the outcome of its code", async () => {
    const m = memory([weekly()]);
    m.tasks.set("w", { ...m.tasks.get("w")!, scheduledAt: new Date("2026-11-02T15:03:00Z"), record: { ...m.tasks.get("w")!.record, scheduledAt: "2026-11-02T15:03:00.000Z" } as ScheduleRecord });
    const d = deps({ store: m.store }, "2026-11-02T15:04:00Z");
    await tick(d);
    const call = vi.mocked(d.launch).mock.calls[0]![0];
    await call.fail({ motivo: "sin créditos", code: "no_credits" }, false);
    expect(vi.mocked(d.deliverFailure).mock.calls[0]![2]).toBe("no_credits");
    await call.onStart();
    expect(m.runs.get("run-1")!.startedAt).toBeInstanceOf(Date);
  });
});

describe("resumeAfterRestart", () => {
  const unfinished = (m: ReturnType<typeof memory>, run: Partial<RunRow>) =>
    m.runs.set(run.id!, { taskId: "w", projectId: "p1", occurrenceAt: new Date("2026-11-02T15:03:00Z"), claimedAt: new Date(), processStartedAt: new Date("2026-11-01T00:00:00Z"), startedAt: null, finishedAt: null, outcome: null, reason: null, reply: null, emailedAt: null, ...run } as RunRow);

  it("a run a deploy cut is told as cut, never run again", async () => {
    const m = memory([weekly()]);
    unfinished(m, { id: "old", startedAt: new Date("2026-11-02T15:03:30Z") });
    const d = deps({ store: m.store }, "2026-11-02T15:10:00Z");
    await resumeAfterRestart(d);
    expect(d.launch).not.toHaveBeenCalled();
    expect(vi.mocked(d.deliverFailure).mock.calls[0]![2]).toBe("cut");
  });

  it("a run claimed but never started, an hour ago, is launched", async () => {
    const m = memory([weekly()]);
    unfinished(m, { id: "old" });
    const d = deps({ store: m.store }, "2026-11-02T16:03:00Z");
    await resumeAfterRestart(d);
    expect(d.launch).toHaveBeenCalledWith(expect.objectContaining({ filaId: "old" }));
  });

  it("a run whose reply was saved but not emailed is emailed, not re-run", async () => {
    const m = memory([weekly()]);
    unfinished(m, { id: "old", startedAt: new Date(), reply: "Listo." });
    const d = deps({ store: m.store }, "2026-11-02T16:03:00Z");
    await resumeAfterRestart(d);
    expect(d.launch).not.toHaveBeenCalled();
    expect(d.deliverResult).toHaveBeenCalledWith(expect.objectContaining({ id: "old" }), expect.objectContaining({ id: "w" }), "Listo.", []);
  });

  it("runs of this process are left alone", async () => {
    const m = memory([weekly()]);
    unfinished(m, { id: "mine", processStartedAt: new Date("2026-11-02T00:00:00Z"), startedAt: new Date() });
    const d = deps({ store: m.store }, "2026-11-02T16:03:00Z");
    await resumeAfterRestart(d);
    expect(d.deliverFailure).not.toHaveBeenCalled();
    expect(d.launch).not.toHaveBeenCalled();
  });
});
