// LEN'S SCHEDULE TOOLS (spec local 2026-10-29-tareas-programadas, §7.2): DeepSeek's four, with
// OpenLen's limits (paid plans, one hour, ten per project) and the next run as a local time.
import { describe, expect, it, vi } from "vitest";

import { buildFunctionDeclarations } from "./catalog";
import { REQUIRED_TITLE_MESSAGE } from "@/lib/scheduled-tasks/deepseek/domain";
import type { ScheduleRecord } from "@/lib/scheduled-tasks/deepseek/types";
import { OpenLenScheduleError } from "@/lib/scheduled-tasks/limits";
import type { TaskRow } from "@/lib/scheduled-tasks/store";
import {
  SCHEDULE_DECLARATIONS,
  SCHEDULE_TOOL_NAMES,
  toolScheduleCreate,
  toolScheduleDelete,
  toolScheduleList,
  toolScheduleUpdate,
  type ScheduledTasksDeps,
} from "./schedule-tools";
import { declaracionesDeSoloLectura } from "./subagente";
import type { AgentDeps, AgentSession, ToolOutcome } from "./tools";

const NOW = Date.parse("2026-11-01T20:00:00Z");
const session = { projectId: "p1", userId: "owner", personId: "member", zonaHoraria: "America/Mexico_City", uiLocale: "es" } as AgentSession;
const WEEKLY = { prompt: "Make the PDF of last week's results", title: "PDF de resultados", weekly: { time: "09:03:00", time_zone: "America/Mexico_City", weekdays: [1] } };

function rowOf(record: ScheduleRecord): TaskRow {
  return {
    id: record.id,
    projectId: "p1",
    createdBy: "member",
    locale: "es",
    timeZone: "America/Mexico_City",
    record,
    scheduledAt: new Date(record.scheduledAt),
    status: "active",
    pausedAt: null,
    lastRunId: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
}

function fake(o: { plan?: "free" | "pro"; rows?: TaskRow[] } = {}) {
  const rows = [...(o.rows ?? [])];
  const scheduledTasks: ScheduledTasksDeps = {
    ownerPlan: vi.fn(async () => o.plan ?? "pro"),
    create: vi.fn(async (input) => {
      const row = rowOf(input.record);
      rows.push(row);
      return row;
    }),
    list: vi.fn(async () => rows),
    update: vi.fn(async (_p, id, next) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return "not_found" as const;
      rows[i] = rowOf(next);
      return rows[i]!;
    }),
    remove: vi.fn(async (_p, id) => rows.some((r) => r.id === id)),
    now: () => NOW,
  };
  return { deps: { scheduledTasks } as unknown as AgentDeps, scheduledTasks, rows };
}

const result = (out: ToolOutcome) => JSON.parse(String(out.response.tool_result));

describe("schedule_create", () => {
  it("refuses on Free and saves nothing", async () => {
    const { deps, scheduledTasks } = fake({ plan: "free" });
    const out = result(await toolScheduleCreate(session, deps, WEEKLY));
    expect(out.code).toBe("plan_required");
    expect(out.message).toMatch(/paid plans \(Pro, Max, Ultra\)/);
    expect(scheduledTasks.create).not.toHaveBeenCalled();
  });

  it("saves the task as the person who asked, in the turn's zone, and answers with the local next run", async () => {
    const { deps, scheduledTasks } = fake();
    const out = result(await toolScheduleCreate(session, deps, WEEKLY));
    expect(scheduledTasks.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", createdBy: "member", timeZone: "America/Mexico_City", locale: "es" }));
    expect(out).toMatchObject({ kind: "weekly", title: "PDF de resultados", state: "scheduled", scheduledAtLocal: "2026-11-02T09:03:00-06:00[America/Mexico_City]" });
    expect(out.id).toMatch(/^schedule-[0-9a-f-]{36}$/);
  });

  it("the owner talking is the person who asked", async () => {
    const { deps, scheduledTasks } = fake();
    await toolScheduleCreate({ ...session, personId: undefined } as AgentSession, deps, WEEKLY);
    expect(scheduledTasks.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "owner" }));
  });

  it("refuses anything more often than once an hour", async () => {
    const { deps } = fake();
    expect(result(await toolScheduleCreate(session, deps, { prompt: "p", title: "T", every_seconds: 1800 })).code).toBe("frequency_too_high");
    expect(result(await toolScheduleCreate(session, deps, { prompt: "p", title: "T", cron: { expression: "*/30 * * * *", time_zone: "UTC" } })).code).toBe("invalid_rule");
  });

  it("needs a title, DeepSeek's message", async () => {
    const { deps } = fake();
    const out = result(await toolScheduleCreate(session, deps, { prompt: "p", every_seconds: 3600 }));
    expect(out).toEqual({ code: "invalid_prompt", message: REQUIRED_TITLE_MESSAGE });
  });

  it("answers the store's limit as a code", async () => {
    const { deps, scheduledTasks } = fake();
    vi.mocked(scheduledTasks.create).mockRejectedValueOnce(new OpenLenScheduleError("too_many_schedules", "This project already has 10 active scheduled tasks."));
    expect(result(await toolScheduleCreate(session, deps, WEEKLY)).code).toBe("too_many_schedules");
  });
});

describe("schedule_list / schedule_update / schedule_delete", () => {
  it("lists the project's active tasks as views", async () => {
    const { deps } = fake();
    await toolScheduleCreate(session, deps, WEEKLY);
    const out = result(await toolScheduleList(session, deps, {}));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "PDF de resultados", scheduledAtLocal: "2026-11-02T09:03:00-06:00[America/Mexico_City]" });
  });

  it("moves a task to another time and keeps its id", async () => {
    const { deps, scheduledTasks } = fake();
    const created = result(await toolScheduleCreate(session, deps, WEEKLY));
    const out = result(await toolScheduleUpdate(session, deps, { id: created.id, weekly: { time: "08:00:00", time_zone: "America/Mexico_City", weekdays: [1] } }));
    expect(out).toMatchObject({ id: created.id, scheduledAtLocal: "2026-11-02T08:00:00-06:00[America/Mexico_City]" });
    expect(scheduledTasks.update).toHaveBeenCalledWith("p1", created.id, expect.objectContaining({ time: "08:00:00.000" }), expect.any(Date));
  });

  it("an update below one hour is refused like a create", async () => {
    const { deps } = fake();
    const created = result(await toolScheduleCreate(session, deps, WEEKLY));
    expect(result(await toolScheduleUpdate(session, deps, { id: created.id, every_seconds: 600 })).code).toBe("frequency_too_high");
  });

  it("updating an unknown id is DeepSeek's miss", async () => {
    const { deps } = fake();
    expect(result(await toolScheduleUpdate(session, deps, { id: "schedule-x", title: "T" }))).toEqual({ id: "schedule-x", updated: false, code: "schedule_not_found" });
  });

  it("deletes, and an unknown id is not found", async () => {
    const { deps } = fake();
    const created = result(await toolScheduleCreate(session, deps, WEEKLY));
    expect(result(await toolScheduleDelete(session, deps, { id: created.id }))).toEqual({ id: created.id, deleted: true });
    expect(result(await toolScheduleDelete(session, deps, { id: "schedule-x" }))).toEqual({ id: "schedule-x", deleted: false, code: "schedule_not_found" });
  });
});

describe("the catalog", () => {
  it("declares the four right after the goal's, and none with OPENLEN_SCHEDULE=0", () => {
    const names = buildFunctionDeclarations().map((d) => d.name);
    const at = names.indexOf("update_goal");
    expect(names.slice(at + 1, at + 5)).toEqual([...SCHEDULE_TOOL_NAMES]);
    const off = buildFunctionDeclarations({ OPENLEN_SCHEDULE: "0" }).map((d) => d.name);
    for (const n of SCHEDULE_TOOL_NAMES) expect(off).not.toContain(n);
  });

  it("a read-only subagent never gets them", () => {
    const names = declaracionesDeSoloLectura(buildFunctionDeclarations()).map((d) => d.name);
    for (const n of SCHEDULE_TOOL_NAMES) expect(names).not.toContain(n);
  });

  it("the schemas use only what Len's other tools already send the providers (no oneOf/anyOf/additionalProperties)", () => {
    // These four are always loaded: a construct a provider rejects would break every turn.
    expect(JSON.stringify(SCHEDULE_DECLARATIONS)).not.toMatch(/"(oneOf|anyOf|allOf|additionalProperties)"/);
  });

  it("schedule_create carries Claude Code's minute advice and the one-hour floor", () => {
    const create = SCHEDULE_DECLARATIONS.find((d) => d.name === "schedule_create")!;
    expect(String(create.description)).toMatch(/Minimum interval is 1 hour\./);
    expect(String(create.description)).toMatch(/Avoid the :00 and :30 minute marks/);
    expect(String(create.description)).toMatch(/scheduledAtLocal/);
  });
});
