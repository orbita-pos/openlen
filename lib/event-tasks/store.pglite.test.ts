// @vitest-environment node
//
// Event tasks, their records and their cards against real Postgres (PGlite), with the tables exactly as
// `npm run scheduled-tasks:migrate` creates them (spec local 2026-11-03-len-que-avisa, §7.1, §7.9, §7.10).
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

const { CREATE_SCHEDULED_TASKS, CREATE_EVENT_TASKS } = await import("@/scripts/scheduled-tasks-migrate-sql");
const { ScheduleId, createWeeklyScheduleRecord } = await import("@/lib/scheduled-tasks/deepseek/domain");
const scheduled = await import("@/lib/scheduled-tasks/store");
const store = await import("./store");

const NOW = new Date("2026-11-03T20:00:00Z");
const pg = () => base.pg as PGlite;

const eventInput = (over: Partial<Parameters<typeof store.createEventTask>[0]> = {}) => ({
  projectId: "p1",
  createdBy: "u1",
  locale: "es",
  timeZone: "America/Mexico_City",
  title: "Reservas que chocan",
  prompt: "Avísame si una reserva choca con otra: misma fecha, hora y mesa.",
  source: "app_rows" as const,
  params: { table: "reservas", created_column: "created_at" },
  state: { cursor: { at: "2026-11-03T19:00:00.000Z", key: "r9" } },
  now: NOW,
  ...over,
});

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await db.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await db.query(`INSERT INTO "projects" VALUES ('p1'), ('p2');`);
  for (const statement of [...CREATE_SCHEDULED_TASKS, ...CREATE_EVENT_TASKS]) await db.query(statement);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("event tasks", () => {
  it("claims a due check once", async () => {
    const task = await store.createEventTask(eventInput());
    const [a, b] = await Promise.all([store.claimDueChecks(NOW, 20), store.claimDueChecks(NOW, 20)]);
    expect([...a, ...b].map((t) => t.id)).toEqual([task.id]);
    const [again] = await store.claimDueChecks(new Date(NOW.getTime() + 59_000), 20);
    expect(again).toBeUndefined();
    expect((await store.claimDueChecks(new Date(NOW.getTime() + 60_000), 20)).map((t) => t.id)).toEqual([task.id]);
  });

  it("a paused task is not claimed", async () => {
    const task = await store.createEventTask(eventInput());
    await store.pauseEventTask("p1", task.id, NOW);
    expect(await store.claimDueChecks(NOW, 20)).toEqual([]);
    await store.resumeEventTask("p1", task.id, NOW);
    expect((await store.claimDueChecks(NOW, 20)).map((t) => t.id)).toEqual([task.id]);
  });

  it("a repeated failure is one record with its count", async () => {
    const task = await store.createEventTask(eventInput());
    for (let i = 0; i < 3; i++) await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "failed", reason: "no_column", at: new Date(NOW.getTime() + i * 60_000) });
    const rows = (await pg().query<{ count: number; reason: string }>(`SELECT "count", "reason" FROM "eventTaskRecords"`)).rows;
    expect(rows).toEqual([{ count: 3, reason: "no_column" }]);
  });

  it("a different failure is a new record", async () => {
    const task = await store.createEventTask(eventInput());
    await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "failed", reason: "no_column", at: NOW });
    await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "failed", reason: "no_backend", at: NOW });
    expect((await pg().query(`SELECT 1 FROM "eventTaskRecords"`)).rows).toHaveLength(2);
  });

  it("a delivered record waits for its judge until marked", async () => {
    const task = await store.createEventTask(eventInput());
    const record = await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "delivered", candidate: { subject: "reservas", changes: [], summary: "1 nueva en reservas" }, at: NOW });
    expect((await store.pendingJudges()).map((r) => r.id)).toEqual([record.id]);
    await store.markJudged(record.id, true);
    expect(await store.pendingJudges()).toEqual([]);
    expect((await pg().query<{ judge: string; notified: boolean }>(`SELECT "judge", "notified" FROM "eventTaskRecords"`)).rows).toEqual([{ judge: "done", notified: true }]);
  });

  it(`the daily judge slot refuses at ${24} and resets the next day`, async () => {
    expect(store.EVENT_TASK_DAILY_JUDGES).toBe(24);
    const task = await store.createEventTask(eventInput());
    for (let i = 0; i < 24; i++) expect(await store.takeJudgeSlot(task.id, "2026-11-03")).toBe(true);
    expect(await store.takeJudgeSlot(task.id, "2026-11-03")).toBe(false);
    expect(await store.takeJudgeSlot(task.id, "2026-11-04")).toBe(true);
  });

  it("the cap counts both kinds", async () => {
    for (let i = 0; i < 6; i++) {
      const record = createWeeklyScheduleRecord(ScheduleId(`t${i}`), "PDF", { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1] }, NOW.getTime(), "PDF");
      await scheduled.createTask({ projectId: "p1", createdBy: "u1", locale: "es", timeZone: "America/Mexico_City", record });
    }
    for (let i = 0; i < 4; i++) await store.createEventTask(eventInput());
    expect(await store.countActiveTasks("p1")).toBe(10);
    await expect(store.createEventTask(eventInput())).rejects.toMatchObject({ code: "too_many_schedules" });
    expect(await store.countActiveTasks("p2")).toBe(0);
  });

  it("lists the active tasks of several projects, for the phone's «Tareas»", async () => {
    const a = await store.createEventTask(eventInput());
    const b = await store.createEventTask(eventInput({ projectId: "p2" }));
    const gone = await store.createEventTask(eventInput());
    await store.deactivateEventTask(gone.id, NOW);
    expect((await store.listEventTasksOfProjects(["p1", "p2"])).map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect((await store.listEventTasksOfProjects(["p2"])).map((t) => t.id)).toEqual([b.id]);
    expect(await store.listEventTasksOfProjects([])).toEqual([]);
  });

  it("the lists and the minute's claim leave the judge's conversation out; the task by id has it (review I10)", async () => {
    const t = await store.createEventTask(eventInput());
    await store.saveTranscript(t.id, [{ role: "user", content: "x".repeat(1000) }], NOW);
    expect((await store.listEventTasks("p1"))[0]!.transcript).toBeNull();
    expect((await store.listEventTasksOfProjects(["p1"]))[0]!.transcript).toBeNull();
    expect((await store.claimDueChecks(new Date(NOW.getTime() + 1), 10))[0]!.transcript).toBeNull();
    expect((await store.getEventTaskById(t.id))!.transcript).toHaveLength(1);
  });

  it("deleting the project deletes its tasks, records and cards", async () => {
    const task = await store.createEventTask(eventInput());
    await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "filtered", reason: "estado ≠ confirmada", at: NOW });
    await pg().query(`INSERT INTO "eventTaskCards" ("id","taskId","projectId","recordId","title","summary","proposedAction") VALUES ('c1', $1, 'p1', 'r', 't', 's', 'a')`, [task.id]);
    await pg().query(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    for (const table of ["eventTasks", "eventTaskRecords", "eventTaskCards"]) expect((await pg().query(`SELECT 1 FROM "${table}"`)).rows).toEqual([]);
  });

  it("old records go after 30 days, and only the newest 200 of a task stay", async () => {
    const task = await store.createEventTask(eventInput());
    await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "filtered", reason: "old", at: new Date(NOW.getTime() - 31 * 86_400_000) });
    for (let i = 0; i < 205; i++) await store.writeRecord({ taskId: task.id, projectId: "p1", kind: "filtered", reason: `r${i}`, at: new Date(NOW.getTime() - i * 1000) });
    await store.purgeOldRecords(NOW);
    const rows = (await pg().query<{ reason: string }>(`SELECT "reason" FROM "eventTaskRecords"`)).rows;
    expect(rows).toHaveLength(200);
    expect(rows.some((r) => r.reason === "old" || r.reason === "r204")).toBe(false);
  });
});
