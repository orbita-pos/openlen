// EDITING A TASK, ONE ROAD (spec local 2026-10-29-tareas-programadas, §7.2, §7.8): Len's
// `schedule_update` and the clock's «Guardar» take the same arguments and give the same DeepSeek value
// — DeepSeek's `validateUpdateArgs` and `resolveScheduleUpdate`, plus OpenLen's one-hour floor.
import { ScheduleInputError, MAX_TITLE_LENGTH, REQUIRED_TITLE_MESSAGE } from "./deepseek/domain";
import type { AtInput, CronInput, DailyInput, ScheduleTimingChange, WeeklyInput } from "./deepseek/types";
import { resolveScheduleUpdate } from "./deepseek/update";
import { checkOpenLenLimits, OpenLenScheduleError } from "./limits";
import type { listTasks, updateTask } from "./store";
import { viewForModel } from "./view";

/** A DeepSeek value: a view, a list of views, a result or a `{ code, message }`. */
export type ScheduleToolValue = object;
type ToolError = { readonly code: string; readonly message: string };

/** DeepSeek's and OpenLen's refusals as `{ code, message }`; anything else is DeepSeek's internal error. */
export async function asValue(run: () => Promise<ScheduleToolValue>): Promise<ScheduleToolValue> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ScheduleInputError || error instanceof OpenLenScheduleError) return { code: error.code, message: error.message };
    console.error("[schedule] operation failed", error);
    return { code: "internal_error", message: "The schedule operation failed." };
  }
}

const TIMING = ["at", "every_seconds", "daily", "weekly", "cron"] as const;

/** DeepSeek's `invalidInterval`, without the floor (that is `checkOpenLenLimits`, one place). */
export function invalidInterval(everySeconds: unknown): ToolError | undefined {
  if (everySeconds === undefined) return undefined;
  if (!Number.isSafeInteger(everySeconds)) return { code: "invalid_rule", message: "every_seconds must be a safe integer." };
  return undefined;
}

/** DeepSeek's `validateUpdateArgs`. */
function validateUpdateArgs(args: Record<string, unknown>): ToolError | undefined {
  const selectors = TIMING.filter((k) => args[k] !== undefined).length;
  if (Object.keys(args).some((k) => k !== "id" && k !== "title" && k !== "prompt" && !(TIMING as readonly string[]).includes(k)) || selectors > 1) {
    return { code: "invalid_selector", message: "schedule_update accepts at most one of at, every_seconds, daily, weekly, or cron." };
  }
  if (typeof args.id !== "string" || args.id.length === 0 || args.id.trim() !== args.id) {
    return { code: "invalid_rule", message: "schedule_update id must be non-empty without surrounding whitespace." };
  }
  if (selectors === 0 && args.title === undefined && args.prompt === undefined) {
    return { code: "invalid_selector", message: "schedule_update needs a new title, prompt, or one of at, every_seconds, daily, weekly, or cron." };
  }
  if (args.title !== undefined && (typeof args.title !== "string" || args.title.trim().length === 0)) return { code: "invalid_prompt", message: REQUIRED_TITLE_MESSAGE };
  if (typeof args.title === "string" && args.title.trim().length > MAX_TITLE_LENGTH) return { code: "invalid_prompt", message: `title must be at most ${MAX_TITLE_LENGTH} characters.` };
  if (args.prompt !== undefined && (typeof args.prompt !== "string" || args.prompt.trim().length === 0)) return { code: "invalid_prompt", message: "prompt must be non-empty after trimming." };
  return invalidInterval(args.every_seconds);
}

/** DeepSeek's `timingChangeFrom`. */
function timingChangeFrom(args: Record<string, unknown>): ScheduleTimingChange | undefined {
  if (args.at !== undefined) return { kind: "at", at: args.at as AtInput };
  if (args.every_seconds !== undefined) return { kind: "every", every_seconds: args.every_seconds as number };
  if (args.daily !== undefined) return { kind: "daily", daily: args.daily as DailyInput };
  if (args.weekly !== undefined) return { kind: "weekly", weekly: args.weekly as WeeklyInput };
  if (args.cron !== undefined) return { kind: "cron", cron: args.cron as CronInput };
  return undefined;
}

export interface UpdateDeps {
  list: typeof listTasks;
  update: typeof updateTask;
  now(): number;
}

/** `schedule_update`'s value for `args` (with `id`), in the project. Throws DeepSeek's or OpenLen's refusals. */
export async function updateScheduledTask(projectId: string, args: Record<string, unknown>, deps: UpdateDeps): Promise<ScheduleToolValue> {
  const invalid = validateUpdateArgs(args);
  if (invalid) return invalid;
  const id = args.id as string;
  const expected = (await deps.list(projectId, { includeInactive: true })).find((row) => row.id === id);
  if (!expected) return { id, updated: false, code: "schedule_not_found" };
  if (expected.status !== "active") return { id, updated: false, code: "schedule_ended" };
  const now = deps.now();
  const result = resolveScheduleUpdate(expected.record, expected.record, timingChangeFrom(args), now, {
    ...(args.title === undefined ? {} : { title: args.title as string }),
    ...(args.prompt === undefined ? {} : { prompt: args.prompt as string }),
  });
  if (!("record" in result)) return result as unknown as Record<string, unknown>;
  if (!result.updated) return viewForModel(expected.record, now, expected.timeZone, { pausedAt: expected.pausedAt });
  checkOpenLenLimits(result.record);
  const saved = await deps.update(projectId, id, result.record, expected.updatedAt);
  if (saved === "not_found") return { id, updated: false, code: "schedule_not_found" };
  if (saved === "conflict") return { id, updated: false, code: "schedule_conflict" };
  return viewForModel(saved.record, now, saved.timeZone, { pausedAt: saved.pausedAt });
}
