// The clock's API (spec local 2026-10-29-tareas-programadas, §7.8): the project's tasks with their last
// run, and editing or deleting one — for whoever can talk to Len there (owner and editors).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: vi.fn(async () => "ana") }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/scheduled-tasks/store", () => ({ listTasks: vi.fn(), getRun: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }));

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { ScheduleId, createWeeklyScheduleRecord } from "@/lib/scheduled-tasks/deepseek/domain";
import { deleteTask, getRun, listTasks, updateTask } from "@/lib/scheduled-tasks/store";
import type { TaskRow } from "@/lib/scheduled-tasks/store";
import { GET } from "./route";
import { DELETE, PATCH } from "./[taskId]/route";

const record = createWeeklyScheduleRecord(ScheduleId("schedule-1"), "Make the PDF", { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1] }, Date.now(), "PDF de resultados");
const row = { id: "schedule-1", projectId: "p1", createdBy: "ana", locale: "es", timeZone: "America/Mexico_City", record, scheduledAt: new Date(record.scheduledAt), status: "active", lastRunId: "run-1", createdAt: new Date(), updatedAt: new Date(0) } as TaskRow;
const ctx = { params: Promise.resolve({ id: "p1" }) };
const taskCtx = { params: Promise.resolve({ id: "p1", taskId: "schedule-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "ana" } } as never);
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" } as never);
  vi.mocked(listTasks).mockResolvedValue([row]);
  vi.mocked(getRun).mockResolvedValue({ id: "run-1", occurrenceAt: new Date("2026-10-26T15:03:00Z"), outcome: "no_credits", reason: "Sin créditos." } as never);
  vi.mocked(updateTask).mockImplementation(async (_p, _id, next) => ({ ...row, record: next, scheduledAt: new Date(next.scheduledAt) }));
  vi.mocked(deleteTask).mockResolvedValue(true);
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

  it("with OPENLEN_SCHEDULE=0, writes are off", async () => {
    vi.stubEnv("OPENLEN_SCHEDULE", "0");
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), taskCtx)).status).toBe(503);
    vi.unstubAllEnvs();
  });
});
