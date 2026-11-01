/**
 * LEN'S SCHEDULE TOOLS (spec local 2026-10-29-tareas-programadas, §7.2). DeepSeek's four
 * (`deepseek-harness` @ 00d5414, MIT, LICENSES/deepseek-harness.MIT.txt:
 * `packages/schedule/tool-schedule/src/index.ts`): `schedule_create`, `schedule_list`,
 * `schedule_delete` and `schedule_update`, with their parameters, their descriptions, their argument
 * checks and their JSON results, which reach the model as the same text (`tool_result`).
 *
 * What OpenLen changes, and nothing else:
 *   · «in the current session» is «in this project's chat»: a task runs in the project's chat.
 *   · The floor is one hour (`checkOpenLenLimits`), and `schedule_create` says so together with
 *     Claude Code's advice from `CronCreate` on the :00/:30 marks and on giving the user the real time.
 *   · «Delivery can repeat after a crash» is gone: a run here is claimed once (store.ts).
 *   · A view carries `scheduledAtLocal` (view.ts), and two refusals of ours: `plan_required` (the
 *     owner is on Free) and `too_many_schedules` (ten per project).
 */
import { randomUUID } from "node:crypto";

import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { Plan } from "@/lib/plan";
import {
  MAX_TITLE_LENGTH,
  REQUIRED_TITLE_MESSAGE,
  ScheduleId,
  ScheduleInputError,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createCronScheduleRecord,
  createDailyScheduleRecord,
  createEveryScheduleRecord,
  createWeeklyScheduleRecord,
  scheduleTitle,
} from "@/lib/scheduled-tasks/deepseek/domain";
import type { AtInput, CronInput, DailyInput, ScheduleRecord, ScheduleTimingChange, WeeklyInput } from "@/lib/scheduled-tasks/deepseek/types";
import { checkOpenLenLimits, OPENLEN_MIN_INTERVAL_SECONDS, OpenLenScheduleError } from "@/lib/scheduled-tasks/limits";
import type { createTask, deleteTask, listTasks, updateTask } from "@/lib/scheduled-tasks/store";
import { invalidInterval, updateScheduledTask } from "@/lib/scheduled-tasks/update-task";
import { viewForModel } from "@/lib/scheduled-tasks/view";

export const SCHEDULE_CREATE = "schedule_create";
export const SCHEDULE_LIST = "schedule_list";
export const SCHEDULE_DELETE = "schedule_delete";
export const SCHEDULE_UPDATE = "schedule_update";
/** In DeepSeek's registration order. */
export const SCHEDULE_TOOL_NAMES = [SCHEDULE_CREATE, SCHEDULE_LIST, SCHEDULE_DELETE, SCHEDULE_UPDATE] as const;

/** What the tools need, injected by the route (fakes in the tests). */
export interface ScheduledTasksDeps {
  /** The plan of the project's OWNER: they pay. */
  ownerPlan(): Promise<Plan>;
  create: typeof createTask;
  list: typeof listTasks;
  update: typeof updateTask;
  remove: typeof deleteTask;
  now(): number;
}

const CREATE_DESCRIPTION =
  "Create a reminder in this project's chat that delivers prompt when it becomes due. " +
  "Supply exactly one timing parameter: after_seconds, at, every_seconds, daily, weekly, or cron. " +
  "Local times that do not exist in the zone are skipped; repeated local times fire once, at the earlier instant. " +
  "After downtime, a recurring reminder delivers only its latest missed occurrence. " +
  "Minimum interval is 1 hour. " +
  'Avoid the :00 and :30 minute marks when the task allows it: when the request is approximate ("every morning around 9"), pick a minute that is not 0 or 30, such as 08:57 or 09:03; use 0 or 30 only when the user names that exact time and clearly means it. ' +
  "When you tell the user when it will run, give the returned scheduledAtLocal, not the time you asked for.";

const LIST_DESCRIPTION = "List the active reminders in this project's chat.";

const DELETE_DESCRIPTION =
  "Delete a reminder in this project's chat, active or inactive. Deletion does not retract a reminder message that is already queued.";

const UPDATE_DESCRIPTION =
  "Change a reminder in place, keeping its id. Supply a new title, prompt, or at most one timing parameter; " +
  "omitted fields keep their stored values. To change a relative delay, create a new reminder.";

const CREATE_TITLE_DESCRIPTION =
  `Concise task name in the user's language, at most ${MAX_TITLE_LENGTH} characters. ` +
  "Name only the core action and subject; keep essential target identifiers such as PR numbers and branch names. " +
  "Do not include execution frequency (e.g. daily, hourly), scheduled dates/times, time zones, task status, " +
  "or configuration and execution details (e.g. read-only mode, profile-tag filters), even when embedded in the requested or existing title. " +
  "Do not append parenthetical notes. " +
  "Put scheduling information in the timing parameters and execution instructions in prompt.";

const ZONE = { type: "STRING", description: "UTC or IANA Area/Location, for example Asia/Shanghai." };

/** DeepSeek's `SELECTOR_PARAMETERS`, as JSON Schema. */
const SELECTOR_PARAMETERS = {
  every_seconds: {
    type: "NUMBER",
    description: `Fixed-rate interval in whole seconds, at least ${OPENLEN_MIN_INTERVAL_SECONDS}, aligned to the creation time; changing it with schedule_update re-aligns it to the save time.`,
  },
  daily: {
    type: "OBJECT",
    description: "Every day at a local time.",
    properties: {
      time: { type: "STRING", description: "HH:mm:ss with optional 1-3 fractional digits, for example 23:00:00." },
      time_zone: ZONE,
    },
    required: ["time", "time_zone"],
  },
  weekly: {
    type: "OBJECT",
    description: "On the given weekdays at a local time.",
    properties: {
      time: { type: "STRING", description: "HH:mm:ss with optional 1-3 fractional digits, for example 09:00:00." },
      time_zone: ZONE,
      weekdays: { type: "ARRAY", description: "ISO weekdays, Monday 1 through Sunday 7, without repetitions.", items: { type: "INTEGER" } },
    },
    required: ["time", "time_zone", "weekdays"],
  },
  cron: {
    type: "OBJECT",
    description: "Five-field Vixie cron expression in a time zone.",
    properties: {
      expression: {
        type: "STRING",
        description: 'minute hour day-of-month month day-of-week, for example "*/15 9-17 * * 1-5". When both day fields are restricted, a date matches if either one matches.',
      },
      time_zone: ZONE,
    },
    required: ["expression", "time_zone"],
  },
  // DeepSeek declares `at` as a string OR a local {date, time, time_zone}; providers get only the string
  // (no `oneOf` in any of Len's schemas), and the parser still takes both.
  at: {
    type: "STRING",
    description: "Absolute target: an RFC 3339 date-time with offset, for example 2026-11-02T09:03:00-06:00.",
  },
} as const;

export const SCHEDULE_DECLARATIONS: Record<string, unknown>[] = [
  {
    name: SCHEDULE_CREATE,
    description: CREATE_DESCRIPTION,
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: { type: "STRING", description: "Reminder content to present when the target becomes due." },
        title: { type: "STRING", description: CREATE_TITLE_DESCRIPTION },
        after_seconds: { type: "NUMBER", description: "Delay in whole seconds." },
        ...SELECTOR_PARAMETERS,
      },
      required: ["prompt", "title"],
    },
  },
  { name: SCHEDULE_LIST, description: LIST_DESCRIPTION, parameters: { type: "OBJECT", properties: {} } },
  {
    name: SCHEDULE_DELETE,
    description: DELETE_DESCRIPTION,
    parameters: { type: "OBJECT", properties: { id: { type: "STRING", description: "Exact schedule id." } }, required: ["id"] },
  },
  {
    name: SCHEDULE_UPDATE,
    description: UPDATE_DESCRIPTION,
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING", description: "Schedule id returned by schedule_list." },
        title: { type: "STRING", description: "New task name; follow the schedule_create title rules." },
        prompt: { type: "STRING", description: "New reminder content." },
        ...SELECTOR_PARAMETERS,
      },
      required: ["id"],
    },
  },
];

type ToolError = { readonly code: string; readonly message: string };

/** The value goes to the model as DeepSeek's `renderValue`: its JSON, as text. */
function answer(value: unknown): ToolOutcome {
  const failed = typeof value === "object" && value !== null && !Array.isArray(value) && "code" in value;
  return { response: { ok: !failed, [CLAVE_TOOL_RESULT]: JSON.stringify(value) } };
}

function internalError(): ToolError {
  return { code: "internal_error", message: "The schedule operation failed." };
}

async function guarded(run: () => Promise<unknown>): Promise<ToolOutcome> {
  try {
    return answer(await run());
  } catch (error) {
    if (error instanceof ScheduleInputError || error instanceof OpenLenScheduleError) return answer({ code: error.code, message: error.message });
    console.error("[schedule] tool failed", error);
    return answer(internalError());
  }
}

function depsOf(deps: AgentDeps): ScheduledTasksDeps | null {
  return deps.scheduledTasks ?? null;
}

const SELECTORS = ["after_seconds", "at", "every_seconds", "daily", "weekly", "cron"] as const;

/** DeepSeek's `validateCreateArgs`. */
function validateCreateArgs(args: Record<string, unknown>): ToolError | undefined {
  const keys = Object.keys(args);
  const selectors = SELECTORS.filter((k) => args[k] !== undefined).length;
  if (keys.some((k) => k !== "prompt" && k !== "title" && !(SELECTORS as readonly string[]).includes(k)) || selectors !== 1) {
    return { code: "invalid_selector", message: "schedule_create accepts exactly one of after_seconds, at, every_seconds, daily, weekly, or cron." };
  }
  if (typeof args.prompt !== "string" || args.prompt.trim().length === 0) return { code: "invalid_prompt", message: "prompt must be non-empty after trimming." };
  if (typeof args.title !== "string" || args.title.trim().length === 0) return { code: "invalid_prompt", message: REQUIRED_TITLE_MESSAGE };
  if (args.title.trim().length > MAX_TITLE_LENGTH) return { code: "invalid_prompt", message: `title must be at most ${MAX_TITLE_LENGTH} characters.` };
  if (args.after_seconds !== undefined && (!Number.isSafeInteger(args.after_seconds) || (args.after_seconds as number) <= 0)) {
    return { code: "invalid_rule", message: "after_seconds must be a positive safe integer." };
  }
  return invalidInterval(args.every_seconds);
}

/** The record DeepSeek's host builds in `create` (`packages/schedule/schedule/src/index.ts`). */
function recordFrom(args: Record<string, unknown>, now: number): ScheduleRecord {
  const title = scheduleTitle(args.title as string);
  const prompt = args.prompt as string;
  const id = ScheduleId(`schedule-${randomUUID()}`);
  if (args.at !== undefined) return createAtScheduleRecord(id, prompt, args.at as AtInput, now, title);
  if (args.after_seconds !== undefined) return createAfterScheduleRecord(id, prompt, args.after_seconds as number, now, title);
  if (args.every_seconds !== undefined) return createEveryScheduleRecord(id, prompt, args.every_seconds as number, now, title);
  if (args.daily !== undefined) return createDailyScheduleRecord(id, prompt, args.daily as DailyInput, now, title);
  if (args.weekly !== undefined) return createWeeklyScheduleRecord(id, prompt, args.weekly as WeeklyInput, now, title);
  return createCronScheduleRecord(id, prompt, args.cron as CronInput, now, title);
}

const FALLBACK_ZONE = "UTC";

export async function toolScheduleCreate(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(async () => {
    const sd = depsOf(deps);
    if (!sd) return internalError();
    const invalid = validateCreateArgs(args);
    if (invalid) return invalid;
    if ((await sd.ownerPlan()) === "free") {
      throw new OpenLenScheduleError(
        "plan_required",
        "Scheduled tasks are part of OpenLen's paid plans (Pro, Max, Ultra), and this project's owner is on Free. Tell the user it needs a paid plan; nothing was scheduled.",
      );
    }
    const now = sd.now();
    const record = recordFrom(args, now);
    checkOpenLenLimits(record);
    const row = await sd.create({
      projectId: session.projectId,
      createdBy: session.personId ?? session.userId,
      locale: session.uiLocale ?? "en",
      timeZone: session.zonaHoraria ?? FALLBACK_ZONE,
      record,
    });
    return viewForModel(row.record, now, row.timeZone);
  });
}

export async function toolScheduleList(session: AgentSession, deps: AgentDeps, _args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(async () => {
    const sd = depsOf(deps);
    if (!sd) return internalError();
    const now = sd.now();
    return (await sd.list(session.projectId)).map((row) => viewForModel(row.record, now, row.timeZone, { pausedAt: row.pausedAt }));
  });
}

export async function toolScheduleDelete(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(async () => {
    if (typeof args.id !== "string" || args.id.length === 0 || args.id.trim() !== args.id) {
      return { code: "invalid_rule", message: "schedule_delete id must be non-empty without surrounding whitespace." };
    }
    const sd = depsOf(deps);
    if (!sd) return internalError();
    return (await sd.remove(session.projectId, args.id)) ? { id: args.id, deleted: true } : { id: args.id, deleted: false, code: "schedule_not_found" };
  });
}

export async function toolScheduleUpdate(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(async () => {
    const sd = depsOf(deps);
    if (!sd) return internalError();
    return updateScheduledTask(session.projectId, args, sd);
  });
}
