// The phone's «Tareas» (spec local 2026-10-31-len-movil, §5.4–5.5): four sections across projects, and a
// scheduled task paused, resumed, edited or deleted like the web clock.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));
vi.mock("../viewer/phone-viewer", () => ({ PhoneViewer: ({ file }: { file: { name: string } }) => <div role="dialog" aria-label={file.name} /> }));
vi.mock("../api/overview", () => ({ fetchTasks: vi.fn(), setTaskPaused: vi.fn(async () => true), editScheduledTask: vi.fn(async () => ({ ok: true })), deleteScheduledTask: vi.fn(async () => true) }));

import type { TasksOverview } from "@/lib/movil/tasks-overview";
import { deleteScheduledTask, fetchTasks, setTaskPaused } from "../api/overview";
import { TasksTab } from "./tasks-tab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const weekly = {
  id: "t1",
  kind: "weekly",
  title: "Informe",
  prompt: "Haz el PDF",
  scheduledAt: "2026-11-16T15:00:00.000Z",
  scheduledAtLocal: "2026-11-16T09:00:00-06:00[America/Mexico_City]",
  state: "scheduled",
  time: "09:00:00.000",
  timeZone: "America/Mexico_City",
  weekdays: [1],
  deliveryMode: "session",
  projectId: "p1",
  projectTitle: "Mi tienda",
  recurring: true,
  lastRun: null,
};

const OVERVIEW = {
  needsYou: [{ kind: "question", projectId: "p2", projectTitle: "Del equipo", text: "¿Qué color?", at: "2026-11-10T18:00:00.000Z", open: "chat" }],
  working: [{ kind: "turn", projectId: "p1", projectTitle: "Mi tienda", text: "", at: "2026-11-10T18:00:00.000Z", open: "chat" }],
  scheduled: [weekly, { ...weekly, id: "o1", kind: "at", title: "Una vez", recurring: false }, { ...weekly, id: "t2", title: "Pausada", paused: true }],
  resolved: [{ kind: "run", projectId: "p1", projectTitle: "Mi tienda", text: "Informe", at: "2026-11-09T15:04:00.000Z", open: "chat", outcome: "done" }],
} as unknown as TasksOverview;

async function paint(overview: TasksOverview = OVERVIEW, onAbrir = vi.fn()) {
  vi.mocked(fetchTasks).mockResolvedValue(overview);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<TasksTab cliente={{} as never} onAbrirProyecto={onAbrir} onCerrar={() => undefined} />));
  return { host, onAbrir };
}

describe("TasksTab", () => {
  it("shows the four sections in order, each row with its project", async () => {
    const { host } = await paint();
    expect([...host.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["teNecesita", "trabajando", "programadas", "resueltas"]);
    const needs = host.querySelector("[data-needs-you]");
    expect(needs?.textContent).toContain("¿Qué color?");
    expect(needs?.textContent).toContain("Del equipo");
  });

  it("a row of «Te necesita» goes to where it is answered", async () => {
    const { host, onAbrir } = await paint();
    act(() => host.querySelector<HTMLButtonElement>("[data-needs-you]")!.click());
    expect(onAbrir).toHaveBeenCalledWith("p2", "chat");
  });

  it("a recurring task pauses; a paused one says so and resumes; a one-shot has neither", async () => {
    const { host } = await paint();
    const row = (id: string) => host.querySelector(`[data-task="${id}"]`)!;
    expect(row("o1").querySelector("[data-pause],[data-resume]")).toBeNull();
    expect(row("t2").textContent).toContain("enPausa");
    await act(async () => row("t1").querySelector<HTMLButtonElement>("[data-pause]")!.click());
    expect(setTaskPaused).toHaveBeenCalledWith(expect.anything(), "p1", "t1", true);
    await act(async () => row("t2").querySelector<HTMLButtonElement>("[data-resume]")!.click());
    expect(setTaskPaused).toHaveBeenCalledWith(expect.anything(), "p1", "t2", false);
  });

  it("deleting asks first", async () => {
    const { host } = await paint();
    const row = host.querySelector('[data-task="t1"]')!;
    act(() => row.querySelector<HTMLButtonElement>("[data-delete]")!.click());
    expect(deleteScheduledTask).not.toHaveBeenCalled();
    expect(row.textContent).toContain("confirmarBorrar");
    await act(async () => row.querySelector<HTMLButtonElement>("[data-confirm-delete]")!.click());
    expect(deleteScheduledTask).toHaveBeenCalledWith(expect.anything(), "p1", "t1");
  });

  it("a pause the server refuses is said on its row", async () => {
    vi.mocked(setTaskPaused).mockResolvedValueOnce(false);
    const { host } = await paint();
    const row = (id: string) => host.querySelector(`[data-task="${id}"]`)!;
    await act(async () => row("t1").querySelector<HTMLButtonElement>("[data-pause]")!.click());
    expect(row("t1").querySelector('[role="alert"]')?.textContent).toBe("accionFallo");
    expect(row("t2").querySelector('[role="alert"]')).toBeNull();
  });

  it("a delete that fails keeps the confirmation and says so", async () => {
    vi.mocked(deleteScheduledTask).mockRejectedValueOnce(new Error("offline"));
    const { host } = await paint();
    const row = () => host.querySelector('[data-task="t1"]')!;
    act(() => row().querySelector<HTMLButtonElement>("[data-delete]")!.click());
    await act(async () => row().querySelector<HTMLButtonElement>("[data-confirm-delete]")!.click());
    expect(row().querySelector('[role="alert"]')?.textContent).toBe("accionFallo");
    expect(row().querySelector("[data-confirm-delete]")).not.toBeNull();
  });

  it("the last run's files open in the viewer", async () => {
    const file = { name: "informe.pdf", url: "/api/projects/p1/deliveries/turn-1/ab12cd34-informe.pdf", size: 10, previewUrl: null, description: null };
    const withFiles = { ...OVERVIEW, scheduled: [{ ...weekly, lastRun: { at: "2026-11-09T15:00:00.000Z", outcome: "done", reason: null, files: [file] } }] } as unknown as TasksOverview;
    const { host } = await paint(withFiles);
    const row = host.querySelector('[data-task="t1"]')!;
    const button = row.querySelector<HTMLButtonElement>("[data-run-file]")!;
    expect(button.textContent).toContain("informe.pdf");
    act(() => button.click());
    expect(document.body.querySelector('[role="dialog"][aria-label="informe.pdf"]')).not.toBeNull();
  });

  it("with nothing at all it says so", async () => {
    const { host } = await paint({ needsYou: [], working: [], scheduled: [], resolved: [] });
    expect(host.textContent).toContain("vacioTareas");
  });

  it("tasks tab lists an event task with its records", async () => {
    const event = {
      id: "e1",
      projectId: "p1",
      projectTitle: "Mi tienda",
      title: "Reservas que chocan",
      prompt: "Avísame si chocan.",
      source: "app_rows",
      params: { table: "reservas", created_column: "created_at" },
      paused: false,
      lastCheckedAt: "2026-11-10T17:59:00.000Z",
      records: [
        { id: "r1", kind: "delivered", reason: null, count: 1, notified: true, at: "2026-11-10T17:00:00.000Z" },
        { id: "r2", kind: "failed", reason: "table_missing", count: 2, notified: null, at: "2026-11-10T16:00:00.000Z" },
        { id: "r3", kind: "applied", reason: "mesa 4 → 1 · Marta", count: 1, notified: null, at: "2026-11-10T15:00:00.000Z" },
      ],
    };
    const { host } = await paint({ ...OVERVIEW, events: [event] } as unknown as TasksOverview);
    expect([...host.querySelectorAll("h2")].map((h) => h.textContent)).toContain("eventTasks.filterEvents");
    const row = host.querySelector('[data-event-task="e1"]')!;
    expect(row.textContent).toContain("Reservas que chocan");
    expect(row.textContent).toContain("Mi tienda");
    expect(row.textContent).toContain('eventTasks.sourceRows {"table":"reservas"}');
    act(() => row.querySelector<HTMLButtonElement>("[data-event-records]")!.click());
    const lines = [...row.querySelectorAll("[data-event-record]")].map((li) => li.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("eventTasks.recNotified");
    expect(lines[2]).toContain('eventTasks.recApplied {"reason":"mesa 4 → 1 · Marta"}');
    expect(lines[1]).toContain('eventTasks.recFailed {"reason":"table_missing"}');
    expect(lines[1]).toContain('eventTasks.recCount {"count":2}');
  });

  it("an event task pauses and is deleted from the phone too", async () => {
    const event = { id: "e1", projectId: "p1", projectTitle: "Mi tienda", title: "Reservas", prompt: "x", source: "form_submissions", params: {}, paused: false, lastCheckedAt: null, records: [] };
    const { host } = await paint({ ...OVERVIEW, events: [event] } as unknown as TasksOverview);
    const row = host.querySelector('[data-event-task="e1"]')!;
    expect(row.textContent).toContain("eventTasks.sourceAllForms");
    await act(async () => row.querySelector<HTMLButtonElement>("[data-pause]")!.click());
    expect(setTaskPaused).toHaveBeenCalledWith(expect.anything(), "p1", "e1", true);
    act(() => host.querySelector<HTMLButtonElement>('[data-event-task="e1"] [data-delete]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-event-task="e1"] [data-confirm-delete]')!.click());
    expect(deleteScheduledTask).toHaveBeenCalledWith(expect.anything(), "p1", "e1");
  });

  it("a pending card of «Te necesita» opens its project's chat on that card", async () => {
    const aviso = { kind: "aviso", projectId: "p1", projectTitle: "Mi tienda", text: "Dos reservas a la misma hora", at: "2026-11-10T18:00:00.000Z", open: "chat", card: "c1" };
    const { host, onAbrir } = await paint({ ...OVERVIEW, needsYou: [aviso] } as unknown as TasksOverview);
    act(() => host.querySelector<HTMLButtonElement>("[data-needs-you]")!.click());
    expect(onAbrir).toHaveBeenCalledWith("p1", "chat", "c1");
  });
});
