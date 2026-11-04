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
 *   events     their event tasks (spec local 2026-11-03-len-que-avisa, §8) with their records; and a pending
 *              card of one needs them, in its project's chat.
 *
 * Every read is injected (`TasksOverviewDeps`): the route passes the stores, the test passes doubles.
 */
import type { GoalSnapshot } from "@/lib/agent/goal";
import type { DeliveryIndexRow } from "@/lib/agent/skills/delivery-index";
import { asksTheOwner } from "@/lib/agent/ask-user-question";
import type { Incident } from "@/lib/len-watch/types";
import type { VisibleProject } from "@/lib/projects/visible-projects";
import type { StoredChatTurn } from "@/lib/projects/types";
import { isRecurringScheduleRecord } from "@/lib/scheduled-tasks/deepseek/domain";
import { waitingFrom } from "@/lib/scheduled-tasks/waiting";
import type { RunRow, RunWithTask, TaskRow } from "@/lib/scheduled-tasks/store";
import type { EventTaskCardRow, EventTaskRecordRow, EventTaskRow } from "@/lib/event-tasks/store";
import { viewForModel, type OpenLenScheduleView } from "@/lib/scheduled-tasks/view";

const RESOLVED_DAYS = 7;
/** An event task's latest records on the phone: a screen, not the web clock's 50. */
const EVENT_RECORDS = 20;
const DAY_MS = 86_400_000;
/** Len Watch states where the person has something to do. */
const WATCH_NEEDS_YOU: readonly Incident["status"][] = ["fix_ready", "needs_owner", "fix_failed"];

export type { VisibleProject };

export interface OverviewItem {
  /** `aviso`: an event task's card waiting for «Hazlo» or «Ahora no» (spec local 2026-11-03-len-que-avisa). */
  readonly kind: "question" | "waiting" | "goal" | "len_watch" | "turn" | "run" | "incident" | "aviso";
  readonly projectId: string;
  readonly projectTitle: string;
  readonly text: string;
  readonly at: string;
  /** Where in the project it is answered. */
  readonly open: "chat" | "gestion";
  /** A run's outcome (`done`, `no_credits`…). */
  readonly outcome?: string | null;
  /** An `aviso`'s card, which its chat brings into view. */
  readonly card?: string;
}

/** An event task (spec local 2026-11-03-len-que-avisa, §8): what it watches, read-only, and its records — what
 *  each look found, never what a visitor sent nor the judge's conversation. */
export interface EventItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly title: string;
  readonly prompt: string;
  readonly source: string;
  readonly params: Record<string, unknown>;
  readonly paused: boolean;
  readonly lastCheckedAt: string | null;
  readonly records: { readonly id: string; readonly kind: string; readonly reason: string | null; readonly count: number; readonly notified: boolean | null; readonly at: string }[];
}

/** A file Len delivered in a scheduled task's last run, opened from «Programadas». */
export interface RunFile {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly previewUrl: string | null;
  readonly description: string | null;
}

export type ScheduledItem = OpenLenScheduleView & {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly recurring: boolean;
  readonly lastRun: { readonly at: string; readonly outcome: string | null; readonly reason: string | null; readonly files: RunFile[] } | null;
};

export interface TasksOverview {
  readonly needsYou: OverviewItem[];
  readonly working: OverviewItem[];
  readonly scheduled: ScheduledItem[];
  readonly resolved: OverviewItem[];
  /** Always sent by this server; optional for the phone, which an older server answers without it. */
  readonly events?: EventItem[];
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
  /** What Len delivered in a project between two instants: a run's files (its row does not keep its turn,
   *  and a project runs one turn at a time). */
  deliveriesBetween(projectId: string, from: Date, to: Date): Promise<DeliveryIndexRow[]>;
  /** Event tasks, when they are on: the active ones of these projects, a task's records, the pending cards. */
  eventTasksOf?(projectIds: readonly string[]): Promise<EventTaskRow[]>;
  eventRecordsOf?(taskId: string, limit: number): Promise<EventTaskRecordRow[]>;
  pendingCardsOf?(projectIds: readonly string[]): Promise<EventTaskCardRow[]>;
}

const canEdit = (p: VisibleProject) => p.role === "dueno" || p.role === "editor";
const newestFirst = (a: OverviewItem, b: OverviewItem) => b.at.localeCompare(a.at);

export async function buildTasksOverview(userId: string, deps: TasksOverviewDeps): Promise<TasksOverview> {
  const projects = await deps.visibleProjects(userId);
  if (projects.length === 0) return { needsYou: [], working: [], scheduled: [], resolved: [], events: [] };
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
        // The stored publish card never says it was published: the project does.
        const published = (c: { tool: string }) => c.tool === "publish" && turn !== null && p.publishedAt !== null && p.publishedAt >= turn.createdAt;
        const waiting = turn ? waitingFrom((turn.actions ?? []).filter((c) => !published(c))) : [];
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

  const [tasks, runs, incidents, eventTasks, cards] = await Promise.all([
    deps.tasksOf(editable.map((p) => p.id)),
    deps.runsSince(ids, since),
    deps.resolvedIncidents(editable.map((p) => p.id), since),
    deps.eventTasksOf ? deps.eventTasksOf(editable.map((p) => p.id)) : Promise.resolve([]),
    // A card is decided by whoever can edit the project, like the web's buttons.
    deps.pendingCardsOf ? deps.pendingCardsOf(editable.map((p) => p.id)) : Promise.resolve([]),
  ]);
  for (const c of cards) {
    const p = byId.get(c.projectId);
    if (p && canEdit(p)) needsYou.push(item(p, { kind: "aviso", text: c.title, at: c.createdAt.toISOString(), open: "chat", card: c.id }));
  }
  const events = await Promise.all(
    eventTasks
      .filter((t) => byId.has(t.projectId) && canEdit(byId.get(t.projectId)!))
      .map(async (t): Promise<EventItem> => {
        const records = deps.eventRecordsOf ? await deps.eventRecordsOf(t.id, EVENT_RECORDS) : [];
        const p = byId.get(t.projectId)!;
        return {
          id: t.id,
          projectId: p.id,
          projectTitle: p.title,
          title: t.title,
          prompt: t.prompt,
          source: t.source,
          params: t.params,
          paused: t.pausedAt !== null,
          lastCheckedAt: t.lastCheckedAt ? t.lastCheckedAt.toISOString() : null,
          records: records.map((r) => ({ id: r.id, kind: r.kind, reason: r.reason, count: r.count, notified: r.notified, at: r.lastAt.toISOString() })),
        };
      }),
  );
  const scheduled = await Promise.all(
    tasks
      .filter((t) => byId.has(t.projectId) && canEdit(byId.get(t.projectId)!))
      .map(async (t): Promise<ScheduledItem> => {
        const last = t.lastRunId ? await deps.runOf(t.lastRunId) : null;
        const files = last?.finishedAt ? await deps.deliveriesBetween(t.projectId, last.startedAt ?? last.claimedAt, last.finishedAt) : [];
        const p = byId.get(t.projectId)!;
        return {
          ...viewForModel(t.record, now.getTime(), t.timeZone, { pausedAt: t.pausedAt }),
          projectId: p.id,
          projectTitle: p.title,
          recurring: isRecurringScheduleRecord(t.record),
          lastRun: last
            ? {
                at: last.occurrenceAt.toISOString(),
                outcome: last.outcome,
                reason: last.reason,
                files: files.map((f) => ({ name: f.name, url: f.url, size: f.size, previewUrl: f.previewUrl, description: f.description })),
              }
            : null,
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
  return { needsYou: needsYou.sort(newestFirst), working: working.sort(newestFirst), scheduled, resolved: resolved.sort(newestFirst), events };
}
