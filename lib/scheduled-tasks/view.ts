// WHAT THE MODEL READS OF A TASK: DeepSeek's view, plus the next run as a local time. Claude Code's
// `CronCreate` tells the model "when you tell the user when a job will run, give that time, not the
// minute in the cron expression"; converting UTC to a zone is exactly what a model gets wrong, so the
// tool does it (spec local 2026-10-29-tareas-programadas, §7.1).
import { Temporal } from "@js-temporal/polyfill";

import { scheduleView } from "./deepseek/domain";
import type { ScheduleRecord, ScheduleView } from "./deepseek/types";

export type OpenLenScheduleView = ScheduleView & {
  /** The next run in the rule's zone (or the task's, for rules without one), e.g. `2026-11-02T09:03:00-06:00[America/Mexico_City]`. */
  readonly scheduledAtLocal: string;
  /** Paused by a person (spec local 2026-10-31-len-movil, §5.5): Len says so and that it resumes with
   *  the button. Absent when not paused, so the view of every other task stays byte for byte. */
  readonly paused?: true;
};

export function viewForModel(record: ScheduleRecord, now: number, fallbackTimeZone: string, o: { readonly pausedAt?: Date | null } = {}): OpenLenScheduleView {
  const zone = "timeZone" in record ? record.timeZone : fallbackTimeZone;
  const scheduledAtLocal = Temporal.Instant.from(record.scheduledAt).toZonedDateTimeISO(zone).toString({ smallestUnit: "second" });
  return Object.freeze({ ...scheduleView(record, now), scheduledAtLocal, ...(o.pausedAt ? { paused: true as const } : {}) });
}
