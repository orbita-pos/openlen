// The clock's API (spec local 2026-10-29-tareas-programadas, §7.8): the project's tasks with their last
// run, and editing or deleting one — for whoever can talk to Len there (owner and editors).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: vi.fn(async () => "ana") }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/scheduled-tasks/store", () => ({ listTasks: vi.fn(), getRun: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }));
vi.mock("@/lib/event-tasks/enabled", () => ({ eventTasksEnabled: vi.fn(() => true) }));
vi.mock("@/lib/event-tasks/store", () => ({ listEventTasks: vi.fn(), recordsOf: vi.fn(), getEventTask: vi.fn(), updateEventTask: vi.fn(), deleteEventTask: vi.fn() }));

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { ScheduleId, createWeeklyScheduleRecord } from "@/lib/scheduled-tasks/deepseek/domain";
import { deleteTask, getRun, listTasks, updateTask } from "@/lib/scheduled-tasks/store";
import type { TaskRow } from "@/lib/scheduled-tasks/store";
import { eventTasksEnabled } from "@/lib/event-tasks/enabled";
import { deleteEventTask, getEventTask, listEventTasks, recordsOf, updateEventTask } from "@/lib/event-tasks/store";
import type { EventTaskRecordRow, EventTaskRow } from "@/lib/event-tasks/store";
import { GET } from "./route";
import { DELETE, PATCH } from "./[taskId]/route";

const record = createWeeklyScheduleRecord(ScheduleId("schedule-1"), "Make the PDF", { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1] }, Date.now(), "PDF de resultados");
const row = { id: "schedule-1", projectId: "p1", createdBy: "ana", locale: "es", timeZone: "America/Mexico_City", record, scheduledAt: new Date(record.scheduledAt), status: "active", lastRunId: "run-1", createdAt: new Date(), updatedAt: new Date(0) } as TaskRow;
const eventRow = {
  id: "e1",
  projectId: "p1",
  createdBy: "ana",
  locale: "es",
  timeZone: "America/Mexico_City",
  title: "Reservas que chocan",
  prompt: "Avísame si chocan.",
  source: "app_rows",
  params: { table: "reservas", created_column: "created_at" },
  state: { cursor: { at: "-infinity", key: "" }, key_column: "id" },
  status: "active",
  pausedAt: null,
  nextCheckAt: new Date(),
  lastCheckedAt: new Date("2026-11-03T10:00:00Z"),
  judgeDay: null,
  judgesThatDay: 0,
  transcript: [{ role: "user", content: "visitor data" }],
  lastJudgedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as EventTaskRow;
const eventRecord = {
  id: "r1",
  taskId: "e1",
  projectId: "p1",
  kind: "filtered",
  reason: "estado ≠ confirmada",
  count: 3,
  candidate: { secret: "visitor data" },
  judge: null,
  notified: null,
  firstAt: new Date("2026-11-03T08:00:00Z"),
  lastAt: new Date("2026-11-03T09:00:00Z"),
} as unknown as EventTaskRecordRow;
const ctx = { params: Promise.resolve({ id: "p1" }) };
const eventCtx = { params: Promise.resolve({ id: "p1", taskId: "e1" }) };
const taskCtx = { params: Promise.resolve({ id: "p1", taskId: "schedule-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "ana" } } as never);
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" } as never);
  vi.mocked(listTasks).mockResolvedValue([row]);
  vi.mocked(getRun).mockResolvedValue({ id: "run-1", occurrenceAt: new Date("2026-10-26T15:03:00Z"), outcome: "no_credits", reason: "Sin créditos." } as never);
  vi.mocked(updateTask).mockImplementation(async (_p, _id, next) => ({ ...row, record: next, scheduledAt: new Date(next.scheduledAt) }));
  vi.mocked(deleteTask).mockResolvedValue(true);
  vi.mocked(eventTasksEnabled).mockReturnValue(true);
  vi.mocked(listEventTasks).mockResolvedValue([]);
  vi.mocked(recordsOf).mockResolvedValue([]);
  vi.mocked(getEventTask).mockResolvedValue(null);
  vi.mocked(deleteEventTask).mockResolvedValue(false);
});

describe("GET /api/projects/[id]/scheduled-tasks", () => {
  it("lists the tasks with their local next run and their last run", async () => {
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    const { tasks } = (await res.json()) as { tasks: Record<string, unknown>[] };
    expect(tasks[0]).toMatchObject({ id: "schedule-1", title: "PDF de resultados", createdBy: "ana", lastRun: { at: "2026-10-26T15:03:00.000Z", outcome: "no_credits", reason: "Sin créditos." } });
    expect(String(tasks[0]!.scheduledAtLocal)).toMatch(/\[America\/Mexico_City\]$/);
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "ana", "editar");
  });

  it("the phone reads it with its key, with the app's CORS", async () => {
    const res = await GET(new Request("http://x", { headers: { authorization: `Bearer ${"k".repeat(32)}`, origin: "https://localhost" } }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "ana", "editar");
    expect(auth).not.toHaveBeenCalled();
  });

  it("lists the event tasks with their latest records, and none of what a visitor sent", async () => {
    vi.mocked(listEventTasks).mockResolvedValue([eventRow]);
    vi.mocked(recordsOf).mockResolvedValue([eventRecord]);
    const res = await GET(new Request("http://x"), ctx);
    const { events } = (await res.json()) as { events: Record<string, unknown>[] };
    expect(events).toEqual([
      {
        id: "e1",
        kind: "event",
        title: "Reservas que chocan",
        prompt: "Avísame si chocan.",
        source: "app_rows",
        params: { table: "reservas", created_column: "created_at" },
        lastCheckedAt: "2026-11-03T10:00:00.000Z",
        createdBy: "ana",
        records: [{ id: "r1", kind: "filtered", reason: "estado ≠ confirmada", count: 3, notified: null, at: "2026-11-03T09:00:00.000Z" }],
      },
    ]);
    expect(recordsOf).toHaveBeenCalledWith("e1", 50);
    expect(JSON.stringify(events)).not.toContain("visitor data");
  });

  it("with event tasks off, there are none", async () => {
    vi.mocked(eventTasksEnabled).mockReturnValue(false);
    vi.mocked(listEventTasks).mockResolvedValue([eventRow]);
    const { events } = (await (await GET(new Request("http://x"), ctx)).json()) as { events: unknown[] };
    expect(events).toEqual([]);
  });

  it("a reader is refused like the rest of Len", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue(new Response(null, { status: 403 }) as never);
    expect((await GET(new Request("http://x"), ctx)).status).toBe(403);
  });
});

describe("PATCH / DELETE /api/projects/[id]/scheduled-tasks/[taskId]", () => {
  it("moves a task, sending one update with the new rule", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ title: "Otro", weekly: { time: "08:00:00", time_zone: "America/Mexico_City", weekdays: [1] } }) }), taskCtx);
    expect(res.status).toBe(200);
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateTask).mock.calls[0]![2]).toMatchObject({ title: "Otro", time: "08:00:00.000" });
  });

  it("refuses anything more often than once an hour", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ every_seconds: 600 }) }), taskCtx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("frequency_too_high");
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("deletes, and an unknown task is 404", async () => {
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), taskCtx)).status).toBe(200);
    vi.mocked(deleteTask).mockResolvedValue(false);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), taskCtx)).status).toBe(404);
  });

  it("an event task's name and prompt change; nothing else does", async () => {
    vi.mocked(getEventTask).mockResolvedValue(eventRow);
    vi.mocked(updateEventTask).mockResolvedValue({ ...eventRow, title: "Choques" } as EventTaskRow);
    const ok = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ title: "Choques", prompt: "Avísame si chocan." }) }), eventCtx);
    expect(ok.status).toBe(200);
    expect(updateEventTask).toHaveBeenCalledWith("p1", "e1", { title: "Choques", prompt: "Avísame si chocan." }, expect.any(Date));
    const refused = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ every_seconds: 7200 }) }), eventCtx);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe("invalid_selector");
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("deletes an event task", async () => {
    vi.mocked(deleteTask).mockResolvedValue(false);
    vi.mocked(deleteEventTask).mockResolvedValue(true);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), eventCtx);
    expect(res.status).toBe(200);
    expect(deleteEventTask).toHaveBeenCalledWith("p1", "e1");
  });

  it("with OPENLEN_SCHEDULE=0, writes are off", async () => {
    vi.stubEnv("OPENLEN_SCHEDULE", "0");
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), taskCtx)).status).toBe(503);
    vi.unstubAllEnvs();
  });
});
