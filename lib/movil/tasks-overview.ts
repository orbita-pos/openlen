/**
 * THE PHONE'S «TAREAS» (spec local 2026-10-31-len-movil, §5.4 and §5.6), like Claude Duet's Tasks: what
 * is working and what needs the person, across every project they can see, in four sections.
 *
 *   needsYou   what waits for THEIR answer: the last finished turn they started, by the same rule as
 *              the scheduled-task email (`waitingFrom`); a blocked goal; a Len Watch fix waiting, where
 *              they can publish.
 *   working    Len's turns running now, and active goals.
 *   scheduled  the scheduled tasks they can edit (owner and editors, as the web clock).
 *   resolved   the last 7 days: runs of the tasks they created, completed goals, resolved incidents.
 *
 * Every read is injected (`TasksOverviewDeps`): the route passes the stores, the test passes doubles.
 */
import type { GoalSnapshot } from "@/lib/agent/goal";
import { asksTheOwner } from "@/lib/agent/ask-user-question";
import type { Incident } from "@/lib/len-watch/types";
import type { VisibleProject } from "@/lib/projects/visible-projects";
import type { StoredChatTurn } from "@/lib/projects/types";
import { isRecurringScheduleRecord } from "@/lib/scheduled-tasks/deepseek/domain";
import { waitingFrom } from "@/lib/scheduled-tasks/waiting";
import type { RunRow, RunWithTask, TaskRow } from "@/lib/scheduled-tasks/store";
import { viewForModel, type OpenLenScheduleView } from "@/lib/scheduled-tasks/view";

const RESOLVED_DAYS = 7;
const DAY_MS = 86_400_000;
/** Len Watch states where the person has something to do. */
const WATCH_NEEDS_YOU: readonly Incident["status"][] = ["fix_ready", "needs_owner", "fix_failed"];

export type { VisibleProject };

export interface OverviewItem {
  readonly kind: "question" | "waiting" | "goal" | "len_watch" | "turn" | "run" | "incident";
  readonly projectId: string;
  readonly projectTitle: string;
  readonly text: string;
  readonly at: string;
  /** Where in the project it is answered. */
  readonly open: "chat" | "gestion";
  /** A run's outcome (`done`, `no_credits`…). */
  readonly outcome?: string | null;
}

export type ScheduledItem = OpenLenScheduleView & {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly recurring: boolean;
  readonly lastRun: { readonly at: string; readonly outcome: string | null; readonly reason: string | null } | null;
};

export interface TasksOverview {
  readonly needsYou: OverviewItem[];
  readonly working: OverviewItem[];
  readonly scheduled: ScheduledItem[];
  readonly resolved: OverviewItem[];
}

export interface TasksOverviewDeps {
  visibleProjects(userId: string): Promise<VisibleProject[]>;
  now(): Date;
  liveTurns(): readonly { readonly projectId: string; readonly userId: string; readonly rowId: string | null; readonly startedAt: number }[];
  tasksOf(projectIds: readonly string[]): Promise<TaskRow[]>;
  runOf(runId: string): Promise<RunRow | null>;
  runsSince(projectIds: readonly string[], since: Date): Promise<RunWithTask[]>;
  goalOf(projectId: string): Promise<{ goal: GoalSnapshot; at: Date } | null>;
  lastTurnOf(projectId: string, userId: string, isOwner: boolean): Promise<{ id: string; actions: StoredChatTurn["actions"] | null; createdAt: Date } | null>;
  incidentOf(projectId: string): Promise<Incident | null>;
  resolvedIncidents(projectIds: readonly string[], since: Date): Promise<Incident[]>;
}

const canEdit = (p: VisibleProject) => p.role === "dueno" || p.role === "editor";
const newestFirst = (a: OverviewItem, b: OverviewItem) => b.at.localeCompare(a.at);

export async function buildTasksOverview(userId: string, deps: TasksOverviewDeps): Promise<TasksOverview> {
  const projects = await deps.visibleProjects(userId);
  if (projects.length === 0) return { needsYou: [], working: [], scheduled: [], resolved: [] };
  const now = deps.now();
  const since = new Date(now.getTime() - RESOLVED_DAYS * DAY_MS);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const editable = projects.filter(canEdit);
  const ids = projects.map((p) => p.id);
  const item = (p: VisibleProject, o: Omit<OverviewItem, "projectId" | "projectTitle">): OverviewItem => ({ projectId: p.id, projectTitle: p.title, ...o });

  const live = deps.liveTurns().filter((t) => byId.has(t.projectId));
  const needsYou: OverviewItem[] = [];
  const working: OverviewItem[] = live.map((t) => item(byId.get(t.projectId)!, { kind: "turn", text: "", at: new Date(t.startedAt).toISOString(), open: "chat" }));
  const resolved: OverviewItem[] = [];

  await Promise.all(
    projects.map(async (p) => {
      // A turn of theirs still running there has not finished asking anything.
      if (p.role !== "lector" && !live.some((t) => t.projectId === p.id && t.userId === userId)) {
        const turn = await deps.lastTurnOf(p.id, userId, p.role === "dueno");
        const waiting = turn ? waitingFrom(turn.actions ?? []) : [];
        if (turn && waiting.length > 0) {
          const asks = (turn.actions ?? []).some((c) => asksTheOwner(c.tool) && !c.respuesta);
          needsYou.push(item(p, { kind: asks ? "question" : "waiting", text: waiting[0]!, at: turn.createdAt.toISOString(), open: "chat" }));
        }
      }
      if (!canEdit(p)) return;
      const [found, incident] = await Promise.all([deps.goalOf(p.id), deps.incidentOf(p.id)]);
      if (found?.goal.phase === "blocked") needsYou.push(item(p, { kind: "goal", text: found.goal.objective, at: found.at.toISOString(), open: "gestion" }));
      if (found?.goal.phase === "active") working.push(item(p, { kind: "goal", text: found.goal.objective, at: found.at.toISOString(), open: "gestion" }));
      if (found?.goal.phase === "complete" && found.at >= since) resolved.push(item(p, { kind: "goal", text: found.goal.objective, at: found.at.toISOString(), open: "gestion" }));
      if (incident && WATCH_NEEDS_YOU.includes(incident.status)) {
        needsYou.push(item(p, { kind: "len_watch", text: incident.summary ?? incident.reason ?? "", at: incident.updatedAt.toISOString(), open: "gestion" }));
      }
    }),
  );

  const [tasks, runs, incidents] = await Promise.all([
    deps.tasksOf(editable.map((p) => p.id)),
    deps.runsSince(ids, since),
    deps.resolvedIncidents(editable.map((p) => p.id), since),
  ]);
  const scheduled = await Promise.all(
    tasks
      .filter((t) => byId.has(t.projectId) && canEdit(byId.get(t.projectId)!))
      .map(async (t): Promise<ScheduledItem> => {
        const last = t.lastRunId ? await deps.runOf(t.lastRunId) : null;
        const p = byId.get(t.projectId)!;
        return {
          ...viewForModel(t.record, now.getTime(), t.timeZone, { pausedAt: t.pausedAt }),
          projectId: p.id,
          projectTitle: p.title,
          recurring: isRecurringScheduleRecord(t.record),
          lastRun: last ? { at: last.occurrenceAt.toISOString(), outcome: last.outcome, reason: last.reason } : null,
        };
      }),
  );
  for (const r of runs) {
    const p = byId.get(r.projectId);
    if (p && r.createdBy === userId && r.finishedAt) resolved.push(item(p, { kind: "run", text: r.title, at: r.finishedAt.toISOString(), open: "chat", outcome: r.outcome }));
  }
  for (const i of incidents) {
    const p = byId.get(i.projectId);
    if (p && i.resolvedAt) resolved.push(item(p, { kind: "incident", text: i.summary ?? "", at: i.resolvedAt.toISOString(), open: "gestion" }));
  }
  return { needsYou: needsYou.sort(newestFirst), working: working.sort(newestFirst), scheduled, resolved: resolved.sort(newestFirst) };
}
