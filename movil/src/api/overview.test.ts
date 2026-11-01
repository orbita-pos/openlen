// The phone's calls for «Entregado» and «Tareas» (spec local 2026-10-31-len-movil, §5.3–5.5): the
// global lists, and the same edit, pause and delete routes as the web clock.
import { describe, expect, it, vi } from "vitest";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";

import { deleteScheduledTask, editScheduledTask, fetchDelivered, fetchTasks, setTaskPaused } from "./overview";

function client(res: Response = Response.json({})) {
  return { pedir: vi.fn(async () => res.clone()), avisarAlCerrar: vi.fn() } as unknown as ClienteDeOpenLen & { pedir: ReturnType<typeof vi.fn> };
}

describe("overview api", () => {
  it("fetchDelivered reads the global list", async () => {
    const c = client(Response.json({ items: [{ id: "d1" }] }));
    expect(await fetchDelivered(c)).toEqual([{ id: "d1" }]);
    expect(c.pedir).toHaveBeenCalledWith("/api/movil/delivered?limit=50");
  });

  it("fetchTasks reads the overview", async () => {
    const overview = { needsYou: [], working: [], scheduled: [], resolved: [] };
    const c = client(Response.json(overview));
    expect(await fetchTasks(c)).toEqual(overview);
    expect(c.pedir).toHaveBeenCalledWith("/api/movil/tasks");
  });

  it("a failed read throws", async () => {
    await expect(fetchTasks(client(new Response(null, { status: 500 })))).rejects.toThrow();
  });

  it("pause, edit and delete go to the clock's routes", async () => {
    const c = client();
    await setTaskPaused(c, "p 1", "t1", true);
    expect(c.pedir).toHaveBeenLastCalledWith("/api/projects/p%201/scheduled-tasks/t1/pause", { method: "POST", headers: { "content-type": "application/json" }, body: '{"paused":true}' });
    await editScheduledTask(c, "p1", "t1", { title: "Otro", every_seconds: 3600 });
    expect(c.pedir).toHaveBeenLastCalledWith("/api/projects/p1/scheduled-tasks/t1", { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"title":"Otro","every_seconds":3600}' });
    await deleteScheduledTask(c, "p1", "t1");
    expect(c.pedir).toHaveBeenLastCalledWith("/api/projects/p1/scheduled-tasks/t1", { method: "DELETE" });
  });

  it("an edit the server refuses answers its message", async () => {
    const c = client(Response.json({ code: "frequency_too_high", message: "Once an hour at most." }, { status: 400 }));
    expect(await editScheduledTask(c, "p1", "t1", { every_seconds: 60 })).toEqual({ ok: false, code: "frequency_too_high", message: "Once an hour at most." });
  });
});
