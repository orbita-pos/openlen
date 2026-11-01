// The phone's «Tareas», across the projects a person can see (spec local 2026-10-31-len-movil, §5.4 and
// §5.6): what needs them, what Len is doing, their scheduled tasks and what was resolved in 7 days.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { GoalSnapshot } from "@/lib/agent/goal";
import type { Incident } from "@/lib/len-watch/types";
import { ScheduleId, createAtScheduleRecord, createWeeklyScheduleRecord } from "@/lib/scheduled-tasks/deepseek/domain";
import type { RunWithTask, TaskRow } from "@/lib/scheduled-tasks/store";

import { buildTasksOverview, type TasksOverviewDeps } from "./tasks-overview";

const NOW = new Date("2026-11-10T18:00:00Z");
const day = 86_400_000;

const goal = (phase: GoalSnapshot["phase"]): GoalSnapshot => ({ id: "g", revision: 1, objective: "Montar la tienda", phase, maxGoalRounds: 10, roundsStarted: 1 });
const task = (id: string, projectId: string, o: Partial<TaskRow> = {}): TaskRow =>
  ({
    id,
    projectId,
    createdBy: "owner",
    locale: "es",
    timeZone: "America/Mexico_City",
    record: createWeeklyScheduleRecord(ScheduleId(id), "Make the PDF", { time: "09:00:00", time_zone: "America/Mexico_City", weekdays: [1] }, NOW.getTime(), "Informe"),
    scheduledAt: new Date("2026-11-16T15:00:00Z"),
    status: "active",
    pausedAt: null,
    lastRunId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  }) as TaskRow;
const incident = (projectId: string, status: Incident["status"], o: Partial<Incident> = {}) =>
  ({ id: `i-${projectId}`, projectId, status, summary: "Arreglado", reason: null, updatedAt: NOW, createdAt: NOW, resolvedAt: null, ...o }) as Incident;
const run = (o: Partial<RunWithTask>): RunWithTask =>
  ({ id: "r", taskId: "t1", projectId: "own", occurrenceAt: NOW, claimedAt: NOW, processStartedAt: NOW, startedAt: NOW, finishedAt: NOW, outcome: "done", reason: null, reply: null, emailedAt: null, title: "Informe", createdBy: "owner", ...o }) as RunWithTask;

function deps(o: Partial<TasksOverviewDeps> = {}): TasksOverviewDeps {
  return {
    visibleProjects: async () => [
      { id: "own", title: "Mi tienda", role: "dueno", publishedAt: null },
      { id: "shared", title: "Del equipo", role: "editor", publishedAt: null },
      { id: "seen", title: "Sólo mirar", role: "lector", publishedAt: null },
    ],
    now: () => NOW,
    liveTurns: () => [],
    tasksOf: async (ids) => [task("t1", "own"), task("t2", "shared"), task("t3", "seen")].filter((t) => ids.includes(t.projectId)),
    runOf: async () => null,
    runsSince: async () => [],
    goalOf: async () => null,
    lastTurnOf: async () => null,
    incidentOf: async () => null,
    resolvedIncidents: async () => [],
    ...o,
  };
}

describe("buildTasksOverview", () => {
  it("a viewer's projects give no scheduled tasks and no Len Watch item", async () => {
    const out = await buildTasksOverview("owner", deps({ incidentOf: async (p) => incident(p, "fix_ready") }));
    expect(out.scheduled.map((s) => s.projectId).sort()).toEqual(["own", "shared"]);
    expect(out.needsYou.filter((i) => i.kind === "len_watch").map((i) => i.projectId).sort()).toEqual(["own", "shared"]);
  });

  it("a question waits for whoever started the turn, not for the others", async () => {
    const lastTurnOf = vi.fn(async (projectId: string, userId: string) =>
      projectId === "shared" && userId === "owner"
        ? { id: "row", createdAt: new Date(NOW.getTime() - 60_000), actions: [{ tool: "ask_user_question", status: "done" as const, summary: "¿Qué color?" }] }
        : null,
    );
    const owner = await buildTasksOverview("owner", deps({ lastTurnOf }));
    expect(owner.needsYou).toEqual([expect.objectContaining({ kind: "question", projectId: "shared", projectTitle: "Del equipo", text: "¿Qué color?", open: "chat" })]);
    const editor = await buildTasksOverview("editor", deps({ lastTurnOf }));
    expect(editor.needsYou).toEqual([]);
    expect(lastTurnOf).toHaveBeenCalledWith("own", "owner", true);
    expect(lastTurnOf).toHaveBeenCalledWith("shared", "owner", false);
  });

  it("a pending publish waits too, like the scheduled-task email", async () => {
    const out = await buildTasksOverview("owner", deps({ lastTurnOf: async (p) => (p === "own" ? { id: "row", createdAt: NOW, actions: [{ tool: "publish", status: "done" as const, summary: "Publicar en tienda.openlen.app" }] } : null) }));
    expect(out.needsYou).toEqual([expect.objectContaining({ kind: "waiting", projectId: "own", text: "Publicar en tienda.openlen.app" })]);
  });

  // Found by the final review: the stored card never says it was published, so the project does.
  it("a publish done since that turn no longer needs you; one done before it still does", async () => {
    const turn = { id: "row", createdAt: NOW, actions: [{ tool: "publish", status: "done" as const, summary: "Publicar en tienda.openlen.app" }] };
    const lastTurnOf = async (p: string) => (p === "own" ? turn : null);
    const published = (at: Date) => async () => [{ id: "own", title: "Mi tienda", role: "dueno" as const, publishedAt: at }];
    expect((await buildTasksOverview("owner", deps({ lastTurnOf, visibleProjects: published(new Date(NOW.getTime() + 60_000)) }))).needsYou).toEqual([]);
    expect((await buildTasksOverview("owner", deps({ lastTurnOf, visibleProjects: published(new Date(NOW.getTime() - 60_000)) }))).needsYou).toEqual([expect.objectContaining({ kind: "waiting", projectId: "own" })]);
  });

  it("a blocked goal needs you; an active one is working; a complete one in 7 days is resolved", async () => {
    const goalOf = async (p: string) => (p === "own" ? { goal: goal("blocked"), at: NOW } : p === "shared" ? { goal: goal("active"), at: NOW } : { goal: goal("complete"), at: NOW });
    const out = await buildTasksOverview("owner", deps({ goalOf }));
    expect(out.needsYou).toEqual([expect.objectContaining({ kind: "goal", projectId: "own", text: "Montar la tienda", open: "gestion" })]);
    expect(out.working).toEqual([expect.objectContaining({ kind: "goal", projectId: "shared" })]);
    // The viewer's project («seen») is not theirs to act on.
    expect(out.resolved.filter((i) => i.kind === "goal")).toEqual([]);
  });

  it("a paused weekly task is listed paused and recurring; a one-shot is not recurring", async () => {
    const at = createAtScheduleRecord(ScheduleId("o1"), "p", "2026-11-12T09:00:00-06:00", NOW.getTime(), "Una vez");
    const out = await buildTasksOverview("owner", deps({ tasksOf: async () => [task("t1", "own", { pausedAt: NOW }), task("o1", "own", { record: at })] }));
    expect(out.scheduled).toEqual([
      expect.objectContaining({ id: "t1", projectId: "own", projectTitle: "Mi tienda", paused: true, recurring: true }),
      expect.objectContaining({ id: "o1", recurring: false }),
    ]);
    expect(out.scheduled[1]).not.toHaveProperty("paused");
  });

  it("a scheduled task carries how its last run went", async () => {
    const out = await buildTasksOverview("owner", deps({ tasksOf: async () => [task("t1", "own", { lastRunId: "r1" })], runOf: async () => run({ id: "r1", outcome: "no_credits", reason: "Sin créditos." }) }));
    expect(out.scheduled[0]!.lastRun).toEqual({ at: NOW.toISOString(), outcome: "no_credits", reason: "Sin créditos." });
  });

  it("resolved holds their own runs of the last 7 days and resolved incidents", async () => {
    const runsSince = vi.fn(async () => [run({ id: "mine", createdBy: "owner" }), run({ id: "other", createdBy: "someone" })]);
    const out = await buildTasksOverview("owner", deps({ runsSince, resolvedIncidents: async () => [incident("own", "resolved", { resolvedAt: NOW })] }));
    expect(out.resolved.map((i) => i.kind).sort()).toEqual(["incident", "run"]);
    expect(runsSince).toHaveBeenCalledWith(["own", "shared", "seen"], new Date(NOW.getTime() - 7 * day));
  });

  it("working lists live turns only in visible projects", async () => {
    const out = await buildTasksOverview("owner", deps({ liveTurns: () => [{ projectId: "own", userId: "editor", rowId: "row", startedAt: NOW.getTime() }, { projectId: "elsewhere", userId: "x", rowId: null, startedAt: 0 }] }));
    expect(out.working).toEqual([expect.objectContaining({ kind: "turn", projectId: "own", open: "chat" })]);
  });

  it("no projects, nothing at all", async () => {
    expect(await buildTasksOverview("owner", deps({ visibleProjects: async () => [] }))).toEqual({ needsYou: [], working: [], scheduled: [], resolved: [] });
  });
});
