// @vitest-environment node
//
// Scheduled tasks and their runs against real Postgres (PGlite), with the tables exactly as
// `scripts/scheduled-tasks-migrate.ts` creates them.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_SCHEDULED_TASKS } = await import("@/scripts/scheduled-tasks-migrate-sql");
const { ScheduleId, createAtScheduleRecord, createWeeklyScheduleRecord } = await import("./deepseek/domain");
const store = await import("./store");

const NOW = Date.parse("2026-11-01T20:00:00Z");
const weekly = (id: string) =>
  createWeeklyScheduleRecord(ScheduleId(id), "Make the PDF", { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1] }, NOW, "PDF de resultados");
const input = (id: string, over: Partial<{ projectId: string; createdBy: string }> = {}) => ({
  projectId: "p1",
  createdBy: "u1",
  locale: "es",
  timeZone: "America/Mexico_City",
  record: weekly(id),
  ...over,
});

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await pg.query(`INSERT INTO "projects" VALUES ('p1'), ('p2');`);
  for (const statement of CREATE_SCHEDULED_TASKS) await pg.query(statement);
  base.pg = pg;
  base.db = drizzle(pg, { schema });
});

describe("createTask / listTasks", () => {
  it("stores the record and lists it", async () => {
    const row = await store.createTask(input("t1"));
    expect(row.id).toBe("t1");
    expect(row.status).toBe("active");
    expect(row.scheduledAt.toISOString()).toBe("2026-11-02T15:03:00.000Z");
    expect((await store.listTasks("p1")).map((t) => t.id)).toEqual(["t1"]);
  });

  it("refuses the 11th active task of a project", async () => {
    for (let i = 0; i < 10; i++) await store.createTask(input(`t${i}`));
    await expect(store.createTask(input("t10"))).rejects.toMatchObject({ code: "too_many_schedules" });
    // Another project is not counted.
    await expect(store.createTask(input("q1", { projectId: "p2" }))).resolves.toMatchObject({ id: "q1" });
  });

  it("leaves inactive tasks out unless asked", async () => {
    await store.createTask(input("t1"));
    await store.deactivateTask("t1");
    expect(await store.listTasks("p1")).toEqual([]);
    expect((await store.listTasks("p1", { includeInactive: true })).map((t) => t.status)).toEqual(["inactive"]);
  });
});

describe("updateTask / deleteTask", () => {
  it("replaces the record and its next run, and reports a stale write", async () => {
    const row = await store.createTask(input("t1"));
    const next = { ...row.record, title: "Otro", scheduledAt: "2026-11-09T15:03:00.000Z" } as typeof row.record;
    const updated = await store.updateTask("p1", "t1", next, row.updatedAt);
    expect(updated).toMatchObject({ id: "t1" });
    expect(updated !== "conflict" && updated !== "not_found" && updated.scheduledAt.toISOString()).toBe("2026-11-09T15:03:00.000Z");
    expect(await store.updateTask("p1", "t1", next, new Date(0))).toBe("conflict");
    expect(await store.updateTask("p2", "t1", next)).toBe("not_found");
  });

  it("deletes only within its project", async () => {
    await store.createTask(input("t1"));
    expect(await store.deleteTask("p2", "t1")).toBe(false);
    expect(await store.deleteTask("p1", "t1")).toBe(true);
    expect(await store.listTasks("p1")).toEqual([]);
  });

  it("deleteTasksByCreator removes only that person's tasks in that project", async () => {
    await store.createTask(input("a"));
    await store.createTask(input("b", { createdBy: "u2" }));
    await store.createTask(input("c", { projectId: "p2" }));
    expect(await store.deleteTasksByCreator("p1", "u1")).toBe(1);
    expect((await store.listTasks("p1")).map((t) => t.id)).toEqual(["b"]);
    expect((await store.listTasks("p2")).map((t) => t.id)).toEqual(["c"]);
  });
});

describe("dueTasks / claimDue", () => {
  const claim = (task: Awaited<ReturnType<typeof store.createTask>>, runId: string, next: string | null) =>
    store.claimDue(task, { occurrenceAt: task.scheduledAt.toISOString(), nextScheduledAt: next, runId, processStartedAt: new Date(NOW) });

  it("finds what is due", async () => {
    await store.createTask(input("t1"));
    expect(await store.dueTasks(new Date("2026-11-02T15:02:59Z"), 20)).toEqual([]);
    expect((await store.dueTasks(new Date("2026-11-02T15:03:00Z"), 20)).map((t) => t.id)).toEqual(["t1"]);
  });

  it("claims an occurrence once, even when two passes read the same row", async () => {
    const task = await store.createTask(input("t1"));
    const first = await claim(task, "run-1", "2026-11-09T15:03:00.000Z");
    const second = await claim(task, "run-2", "2026-11-09T15:03:00.000Z");
    expect(first).toMatchObject({ id: "run-1", taskId: "t1", projectId: "p1" });
    expect(second).toBeNull();
    const runs = await (base.pg as PGlite).query(`SELECT id FROM "scheduledTaskRuns"`);
    expect(runs.rows).toEqual([{ id: "run-1" }]);
    const [after] = await store.listTasks("p1");
    expect(after?.scheduledAt.toISOString()).toBe("2026-11-09T15:03:00.000Z");
    expect(after?.record.scheduledAt).toBe("2026-11-09T15:03:00.000Z");
    expect(after?.lastRunId).toBe("run-1");
  });

  it("a one-shot claim leaves the task inactive", async () => {
    const at = createAtScheduleRecord(ScheduleId("o1"), "p", "2026-11-02T09:03:00-06:00", NOW, "Una vez");
    const task = await store.createTask({ ...input("o1"), record: at });
    await claim(task, "run-o", null);
    expect(await store.listTasks("p1")).toEqual([]);
  });

  it("markRun and unfinishedRuns follow a run to its end", async () => {
    const task = await store.createTask(input("t1"));
    await claim(task, "run-1", "2026-11-09T15:03:00.000Z");
    expect((await store.unfinishedRuns()).map((r) => r.id)).toEqual(["run-1"]);
    await store.markRun("run-1", { startedAt: new Date(NOW), reply: "Listo" });
    await store.markRun("run-1", { finishedAt: new Date(NOW), outcome: "done" });
    expect(await store.unfinishedRuns()).toEqual([]);
    expect((await store.getRun("run-1"))?.reply).toBe("Listo");
  });
});

describe("cascades and purge", () => {
  it("deleting the project deletes its tasks and runs", async () => {
    const task = await store.createTask(input("t1"));
    await store.claimDue(task, { occurrenceAt: task.scheduledAt.toISOString(), nextScheduledAt: null, runId: "r", processStartedAt: new Date(NOW) });
    await (base.pg as PGlite).query(`DELETE FROM "projects" WHERE id = 'p1'`);
    const left = await (base.pg as PGlite).query(`SELECT (SELECT count(*) FROM "scheduledTasks")::int AS t, (SELECT count(*) FROM "scheduledTaskRuns")::int AS r`);
    expect(left.rows).toEqual([{ t: 0, r: 0 }]);
  });

  it("purges tasks inactive for 30 days and runs older than 90", async () => {
    const task = await store.createTask(input("t1"));
    await store.claimDue(task, { occurrenceAt: task.scheduledAt.toISOString(), nextScheduledAt: null, runId: "r", processStartedAt: new Date(NOW) });
    await store.createTask(input("t2"));
    const day = 86_400_000;
    await store.purgeOld(new Date(Date.now() + 29 * day));
    expect((await store.listTasks("p1", { includeInactive: true })).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    await store.purgeOld(new Date(Date.now() + 31 * day));
    expect((await store.listTasks("p1", { includeInactive: true })).map((t) => t.id)).toEqual(["t2"]);
    // A recurring task keeps going; only its old runs go.
    const [t2] = await store.listTasks("p1");
    await store.claimDue(t2!, { occurrenceAt: t2!.scheduledAt.toISOString(), nextScheduledAt: "2026-11-09T15:03:00.000Z", runId: "r2", processStartedAt: new Date(NOW) });
    await store.purgeOld(new Date(Date.now() + 89 * day));
    expect(await store.getRun("r2")).not.toBeNull();
    await store.purgeOld(new Date(Date.now() + 91 * day));
    expect(await store.getRun("r2")).toBeNull();
    expect((await store.listTasks("p1")).map((t) => t.id)).toEqual(["t2"]);
  });
});
