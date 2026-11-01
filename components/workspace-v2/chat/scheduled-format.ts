// THE CLOCK'S EDITOR, WITHOUT ITS SCREEN (spec local 2026-10-29-tareas-programadas, §7.8; shared with the
// phone since 2026-10-31-len-movil, §5.4): what an edit holds, read from a task, and the PATCH body it
// sends, the same arguments as Len's `schedule_update`. Pure, so the web's clock and the phone's «Tareas»
// send exactly the same thing.

export type Freq = "once" | "daily" | "weekly" | "hours" | "cron";

export interface TaskTiming {
  readonly kind: "after" | "at" | "every" | "daily" | "weekly" | "cron";
  readonly scheduledAtLocal: string;
  readonly time?: string;
  readonly timeZone?: string;
  readonly weekdays?: readonly number[];
  readonly everySeconds?: number;
  readonly expression?: string;
}

export interface TaskEdit {
  readonly title: string;
  readonly prompt: string;
  readonly freq: Freq;
  /** `HH:MM`. */
  readonly time: string;
  /** ISO weekdays, 1 = Monday. */
  readonly days: readonly number[];
  readonly hours: string;
  readonly expression: string;
  /** `YYYY-MM-DD`, for a one-shot. */
  readonly date: string;
  readonly zone: string;
}

export const zoneOf = (task: { readonly timeZone?: string; readonly scheduledAtLocal: string }) => task.timeZone ?? /\[([^\]]+)\]$/.exec(task.scheduledAtLocal)?.[1] ?? "UTC";
export const hhmm = (time: string | undefined) => (time ?? "09:00").slice(0, 5);

export function freqOf(task: { readonly kind: TaskTiming["kind"] }): Freq {
  if (task.kind === "daily") return "daily";
  if (task.kind === "weekly") return "weekly";
  if (task.kind === "every") return "hours";
  if (task.kind === "cron") return "cron";
  return "once";
}

export function editFromTask(task: TaskTiming & { readonly title: string; readonly prompt: string }): TaskEdit {
  return {
    title: task.title,
    prompt: task.prompt,
    freq: freqOf(task),
    time: hhmm(task.time ?? /T(\d\d:\d\d)/.exec(task.scheduledAtLocal)?.[1]),
    days: [...(task.weekdays ?? [1])],
    hours: String(Math.max(1, Math.round((task.everySeconds ?? 3600) / 3600))),
    expression: task.expression ?? "",
    date: /^(\d{4}-\d\d-\d\d)/.exec(task.scheduledAtLocal)?.[1] ?? "",
    zone: zoneOf(task),
  };
}

/** The rule part of the PATCH body; the caller adds `title` and `prompt`. */
export function timingBody(e: TaskEdit): Record<string, unknown> {
  if (e.freq === "daily") return { daily: { time: `${e.time}:00`, time_zone: e.zone } };
  if (e.freq === "weekly") return { weekly: { time: `${e.time}:00`, time_zone: e.zone, weekdays: [...e.days].sort() } };
  if (e.freq === "hours") return { every_seconds: Number(e.hours) * 3600 };
  if (e.freq === "cron") return { cron: { expression: e.expression, time_zone: e.zone } };
  return { at: { date: e.date, time: `${e.time}:00`, time_zone: e.zone } };
}
