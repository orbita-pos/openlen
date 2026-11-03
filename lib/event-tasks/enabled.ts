// The switches (spec local 2026-11-03-len-que-avisa, §7.13): OPENLEN_SCHEDULE=0 turns off every task, both kinds;
// OPENLEN_EVENT_TASKS=0 turns off only the event sources — no watcher, and `schedule_create` offers no `on`.
import { scheduleEnabled } from "@/lib/scheduled-tasks/enabled";

export function eventTasksEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return scheduleEnabled(env) && env.OPENLEN_EVENT_TASKS !== "0";
}
