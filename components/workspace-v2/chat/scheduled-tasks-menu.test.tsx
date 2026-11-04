// THE CLOCK IN THE CHAT'S HEADER (spec local 2026-10-29-tareas-programadas, §7.8; mockups 1 and 2):
// only with tasks; each with its rule, next run and how the last went; edit sends ONE update.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import { ScheduledTasksMenu, type ClockEventTask, type ClockTask } from "./scheduled-tasks-menu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const TASK: ClockTask = {
  id: "schedule-1",
  kind: "weekly",
  title: "PDF de resultados",
  prompt: "Make the PDF",
  scheduledAt: "2026-11-09T15:03:00.000Z",
  scheduledAtLocal: "2026-11-09T09:03:00-06:00[America/Mexico_City]",
  state: "scheduled",
  time: "09:03:00.000",
  timeZone: "America/Mexico_City",
  weekdays: [1],
  createdBy: "ana",
  lastRun: { at: "2026-11-02T15:03:00.000Z", outcome: "no_credits", reason: "Sin créditos." },
};

function paint(tasks: ClockTask[], update = vi.fn(async () => ({ ok: true })), remove = vi.fn(async () => true), setPaused = vi.fn(async () => true), events?: ClockEventTask[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ScheduledTasksMenu scheduled={{ tasks, update, remove, setPaused, ...(events ? { events } : {}) }} />));
  return { host, update, remove, setPaused };
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ScheduledTasksMenu", () => {
  it("without tasks there is no clock", () => {
    expect(paint([]).host.querySelector("[data-scheduled-clock]")).toBeNull();
  });

  it("pauses a recurring task", async () => {
    const { host, setPaused } = paint([TASK]);
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    expect(host.querySelector("[data-scheduled-resume]")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-pause]")!.click());
    expect(setPaused).toHaveBeenCalledWith("schedule-1", true);
  });

  it("a paused task says so and resumes", async () => {
    const { host, setPaused } = paint([{ ...TASK, paused: true }]);
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    expect(host.textContent).toContain("scheduled.paused");
    expect(host.querySelector("[data-scheduled-pause]")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-resume]")!.click());
    expect(setPaused).toHaveBeenCalledWith("schedule-1", false);
  });

  it("a pause that fails is said on its row", async () => {
    const { host } = paint([TASK], undefined, undefined, vi.fn(async () => false));
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-pause]")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("scheduled.actionFailed");
  });

  it("a delete that fails keeps the confirmation and says so", async () => {
    const { host } = paint([TASK], undefined, vi.fn(async () => false));
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-delete]")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-confirm-delete]")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("scheduled.actionFailed");
    expect(host.querySelector("[data-scheduled-confirm-delete]")).not.toBeNull();
  });

  it("a one-shot task has neither pause nor resume", () => {
    const { host } = paint([{ ...TASK, kind: "at" }]);
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    expect(host.querySelector("[data-scheduled-pause]")).toBeNull();
    expect(host.querySelector("[data-scheduled-resume]")).toBeNull();
  });

  it("lists each task with how its last run went", () => {
    const { host } = paint([TASK]);
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    expect(host.textContent).toContain("PDF de resultados");
    expect(host.textContent).toContain("scheduled.outcome_no_credits");
    expect(host.textContent).toContain("scheduled.hint");
  });

  it("Save sends one update with the name, the prompt and the rule", async () => {
    const { host, update } = paint([TASK]);
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-edit]")!.click());
    type(host.querySelector<HTMLInputElement>("[data-field=title]")!, "PDF semanal");
    type(host.querySelector<HTMLInputElement>("[data-field=time]")!, "08:00");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-save]")!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("schedule-1", { title: "PDF semanal", prompt: "Make the PDF", weekly: { time: "08:00:00", time_zone: "America/Mexico_City", weekdays: [1] } });
  });

  it("deleting asks first", async () => {
    const { host, remove } = paint([TASK]);
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-delete]")!.click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-confirm-delete]")!.click());
    expect(remove).toHaveBeenCalledWith("schedule-1");
  });

  describe("event tasks (spec local 2026-11-03-len-que-avisa)", () => {
    const EVENT: ClockEventTask = {
      id: "e1",
      kind: "event",
      title: "Reservas que chocan",
      prompt: "Avísame si dos reservas caen en la misma mesa y hora.",
      source: "app_rows",
      params: { table: "reservas", created_column: "created_at", conditions: [{ field: "estado", op: "eq", value: "confirmada" }] },
      lastCheckedAt: "2026-11-03T10:00:00.000Z",
      createdBy: "ana",
      records: [
        { id: "r1", kind: "delivered", reason: null, count: 1, notified: true, at: "2026-11-03T09:00:00.000Z" },
        { id: "r2", kind: "filtered", reason: "estado ≠ confirmada", count: 3, notified: null, at: "2026-11-03T08:00:00.000Z" },
        { id: "r3", kind: "failed", reason: "table_missing", count: 2, notified: null, at: "2026-11-03T07:00:00.000Z" },
      ],
    };
    const open = (host: HTMLElement) => act(() => host.querySelector<HTMLButtonElement>("[data-scheduled-clock]")!.click());

    it("the menu shows an event task's source read-only and its records", () => {
      const { host } = paint([], undefined, undefined, undefined, [EVENT]);
      open(host);
      const row = host.querySelector('[data-event-task="e1"]')!;
      expect(row.textContent).toContain("Reservas que chocan");
      expect(row.textContent).toContain('eventTasks.sourceRows {"table":"reservas"}');
      expect(row.textContent).toContain("estado eq confirmada");
      // Read-only: the source is text, not a field.
      expect(row.querySelector("input, select, textarea")).toBeNull();
      act(() => row.querySelector<HTMLButtonElement>("[data-event-records]")!.click());
      const lines = [...row.querySelectorAll("[data-event-record]")].map((li) => li.textContent);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("eventTasks.recNotified");
      expect(lines[1]).toContain('eventTasks.recFiltered {"reason":"estado ≠ confirmada"}');
      expect(lines[1]).toContain('eventTasks.recCount {"count":3}');
      expect(lines[2]).toContain('eventTasks.recFailed {"reason":"table_missing"}');
    });

    it("a form task without a form names all the forms", () => {
      const { host } = paint([], undefined, undefined, undefined, [{ ...EVENT, source: "form_submissions", params: {}, records: [] }]);
      open(host);
      const row = host.querySelector('[data-event-task="e1"]')!;
      expect(row.textContent).toContain("eventTasks.sourceAllForms");
      act(() => row.querySelector<HTMLButtonElement>("[data-event-records]")!.click());
      expect(row.textContent).toContain("eventTasks.noRecords");
    });

    it("the filter shows one kind at a time", () => {
      const { host } = paint([TASK], undefined, undefined, undefined, [EVENT]);
      open(host);
      expect(host.querySelector('[data-event-task="e1"]')).not.toBeNull();
      expect(host.textContent).toContain("PDF de resultados");
      act(() => host.querySelector<HTMLButtonElement>('[data-scheduled-filter="events"]')!.click());
      expect(host.textContent).not.toContain("PDF de resultados");
      expect(host.querySelector('[data-event-task="e1"]')).not.toBeNull();
      act(() => host.querySelector<HTMLButtonElement>('[data-scheduled-filter="time"]')!.click());
      expect(host.querySelector('[data-event-task="e1"]')).toBeNull();
      expect(host.textContent).toContain("PDF de resultados");
    });

    it("an event task's editor changes only the name and the prompt", async () => {
      const { host, update } = paint([], undefined, undefined, undefined, [EVENT]);
      open(host);
      act(() => host.querySelector<HTMLButtonElement>('[data-event-task="e1"] [data-scheduled-edit]')!.click());
      expect(host.querySelector("[data-field=time]")).toBeNull();
      expect(host.querySelector("select")).toBeNull();
      type(host.querySelector<HTMLInputElement>("[data-field=title]")!, "Choques de reservas");
      await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-save]")!.click());
      expect(update).toHaveBeenCalledWith("e1", { title: "Choques de reservas", prompt: "Avísame si dos reservas caen en la misma mesa y hora." });
    });

    it("an event task pauses and is deleted like a recurring one", async () => {
      const { host, setPaused, remove } = paint([], undefined, undefined, undefined, [EVENT]);
      open(host);
      await act(async () => host.querySelector<HTMLButtonElement>('[data-event-task="e1"] [data-scheduled-pause]')!.click());
      expect(setPaused).toHaveBeenCalledWith("e1", true);
      act(() => host.querySelector<HTMLButtonElement>('[data-event-task="e1"] [data-scheduled-delete]')!.click());
      await act(async () => host.querySelector<HTMLButtonElement>("[data-scheduled-confirm-delete]")!.click());
      expect(remove).toHaveBeenCalledWith("e1");
    });
  });
});
