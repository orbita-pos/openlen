// OPENLEN'S LIMITS ON A SCHEDULE (spec local 2026-10-29-tareas-programadas, §7.2). DeepSeek lets a
// reminder fire every minute because there each person pays for their own model; here every run is a
// Len turn billed to the project's owner, so the floor is Claude Code's for its cloud routines: one
// hour ("Minimum interval is 1 hour. `*/30 * * * *` will be rejected"). The codes and the error class
// are DeepSeek's, so the model reads them the way it reads theirs.
import { ScheduleInputError } from "./deepseek/domain";
import type { ScheduleRecord } from "./deepseek/types";

export const OPENLEN_MIN_INTERVAL_SECONDS = 3600;
/** Active tasks a project may hold (spec §7.2). */
export const MAX_ACTIVE_TASKS_PER_PROJECT = 10;

/** OpenLen's refusals that DeepSeek has no code for; the tools answer them as `{ code, message }` like theirs. */
export class OpenLenScheduleError extends Error {
  constructor(
    readonly code: "too_many_schedules" | "plan_required",
    message: string,
  ) {
    super(message);
    this.name = "OpenLenScheduleError";
  }
}

/** Throws DeepSeek's `ScheduleInputError` when a rule could run Len more often than once an hour. */
export function checkOpenLenLimits(record: ScheduleRecord): void {
  if (record.kind === "every" && record.everySeconds < OPENLEN_MIN_INTERVAL_SECONDS) {
    throw new ScheduleInputError("frequency_too_high", `every_seconds must be at least ${OPENLEN_MIN_INTERVAL_SECONDS} (minimum interval is 1 hour).`);
  }
  // The expression is DeepSeek's canonical form. With a single minute, two distinct runs always fall
  // in different hours; any list, range or step in the minute field can land twice within one.
  if (record.kind === "cron" && !/^\d+$/.test(record.expression.split(" ")[0] ?? "")) {
    throw new ScheduleInputError("invalid_rule", "cron minute field must name a single minute. Minimum interval is 1 hour.");
  }
}
