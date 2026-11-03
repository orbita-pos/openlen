// WHAT THE CHAT KNOWS OF LEN'S SUBAGENTS (spec local 2026-11-01-subagentes-de-len, §4.8): one view per run, fed
// by the stream's `subagent` events while the launching turn is open and by `GET /api/agent/subagents` after
// (every 3 s while one runs, and on reload). Outside React, like `cambiosEnVivo`: the cards, the turn and the
// live bar read the same runs.

import type { AgentAction } from "../agent-action-card";
import type { SubagentStatus, WorktreeOutcome } from "@/lib/agent/subagents/notice";

export interface SubagentRunView {
  readonly id: string;
  readonly projectId: string;
  readonly preset: string;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly actions: readonly AgentAction[];
  readonly finalText: string | null;
  readonly toolUses: number;
  readonly durationMs: number | null;
  /** Phase 2: a `subagent_fork` child, seeded with Len's conversation. */
  readonly forked?: boolean;
  readonly worktree?: { readonly state: "working" } | WorktreeOutcome | null;
}

const STATUSES: readonly SubagentStatus[] = ["running", "completed", "aborted", "error", "budget", "turn_limit"];
const STEP_STATUSES: readonly AgentAction["status"][] = ["running", "done", "warning", "error"];

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const statusFrom = (v: unknown): SubagentStatus | null => (STATUSES.includes(v as SubagentStatus) ? (v as SubagentStatus) : null);

function stepFrom(v: unknown): AgentAction | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tool = str(o.tool, 64);
  if (!tool || !STEP_STATUSES.includes(o.status as AgentAction["status"])) return null;
  const motivo = str(o.motivo, 200);
  return { tool, status: o.status as AgentAction["status"], summary: str(o.summary, 200) ?? "", ...(motivo ? { motivo } : {}) };
}

function runFrom(projectId: string, v: unknown): SubagentRunView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 64);
  const status = statusFrom(o.status);
  if (!id || !status) return null;
  return {
    id,
    projectId,
    preset: str(o.preset, 64) ?? "general-purpose",
    description: str(o.description, 200) ?? "",
    status,
    actions: Array.isArray(o.actions) ? o.actions.flatMap((a) => stepFrom(a) ?? []) : [],
    finalText: str(o.finalText, 20_000),
    toolUses: typeof o.toolUses === "number" && Number.isFinite(o.toolUses) ? o.toolUses : 0,
    durationMs: typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? o.durationMs : null,
    ...(o.forked === true ? { forked: true } : {}),
    worktree: (o.worktree ?? null) as SubagentRunView["worktree"],
  };
}

let runs: ReadonlyMap<string, SubagentRunView> = new Map();
const listeners = new Set<() => void>();

function put(next: readonly SubagentRunView[]): void {
  if (next.length === 0) return;
  const m = new Map(runs);
  for (const r of next) m.set(r.id, r);
  runs = m;
  for (const l of listeners) l();
}

export const subagentsLive = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The same map until something changes (`useSyncExternalStore`). */
  snapshot: (): ReadonlyMap<string, SubagentRunView> => runs,
  /** A `subagent` event of the stream: it started, a step, how it ended. */
  event(projectId: string, ev: unknown): void {
    if (!ev || typeof ev !== "object") return;
    const o = ev as Record<string, unknown>;
    const id = str(o.id, 64);
    const status = statusFrom(o.status);
    if (!id || !status) return;
    const prev = runs.get(id);
    let actions = prev?.actions ?? [];
    let toolUses = prev?.toolUses ?? 0;
    const step = o.step === undefined ? null : stepFrom(o.step);
    if (step) {
      // As the launcher counts them: a finished step replaces the running one of its tool.
      const i = actions.findIndex((a) => a.tool === step.tool && a.status === "running");
      if (step.status !== "running") toolUses++;
      actions = step.status !== "running" && i >= 0 ? actions.map((a, j) => (j === i ? step : a)) : [...actions, step];
    }
    put([
      {
        id,
        projectId,
        preset: str(o.preset, 64) ?? prev?.preset ?? "general-purpose",
        description: str(o.description, 200) ?? prev?.description ?? "",
        status,
        actions,
        finalText: prev?.finalText ?? null,
        toolUses,
        durationMs: prev?.durationMs ?? null,
        worktree: o.worktree === undefined ? prev?.worktree : o.worktree as SubagentRunView["worktree"],
        ...(prev?.forked ? { forked: true } : {}),
      },
    ]);
  },
  /** The rows of `GET /api/agent/subagents`: the truth, but while a run goes on the stream may have seen more steps. */
  fromServer(projectId: string, list: unknown): void {
    if (!Array.isArray(list)) return;
    put(
      list.flatMap((v) => {
        const r = runFrom(projectId, v);
        if (!r) return [];
        const prev = runs.get(r.id);
        return r.status === "running" && prev && prev.actions.length > r.actions.length ? [{ ...r, actions: prev.actions, toolUses: Math.max(r.toolUses, prev.toolUses) }] : [r];
      }),
    );
  },
  runningCount(projectId: string): number {
    let n = 0;
    for (const r of runs.values()) if (r.projectId === projectId && r.status === "running") n++;
    return n;
  },
  /** For tests. */
  forget(): void {
    runs = new Map();
    for (const l of listeners) l();
  },
};
