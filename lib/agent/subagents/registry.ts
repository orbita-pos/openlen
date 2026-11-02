// THE LIVE SUBAGENTS OF EACH PROJECT (spec local 2026-11-01-subagentes-de-len, §4.6 and §4.7): who runs and
// how to stop them, at most `MAX_ACTIVE_SUBAGENTS` at once (DeepSeek's `maxActiveSubagents`, 8: at the limit
// it refuses, it never queues — a parent waiting for its children must not wait for its own slot), and the
// notices waiting for Len: the live turn takes them before its next call, or a server turn carries them.
//
// In-process, on `globalThis` like exit-flush.ts: the agent route, the launcher and the stop route are
// different bundles. Supposes ONE Next process, like the project's turn queue.

export const MAX_ACTIVE_SUBAGENTS = 8;

export interface QueuedNotice {
  readonly id: string;
  readonly text: string;
}

interface State {
  /** projectId → run id → its stop. */
  readonly live: Map<string, Map<string, AbortController>>;
  readonly notices: Map<string, QueuedNotice[]>;
  readonly waiters: Map<string, Set<() => void>>;
  readonly noticeTurns: Set<string>;
}

const KEY = Symbol.for("openlen.agent.subagents");
type Global = typeof globalThis & { [KEY]?: State };
const state: State = ((globalThis as Global)[KEY] ??= { live: new Map(), notices: new Map(), waiters: new Map(), noticeTurns: new Set() });

function wake(projectId: string): void {
  const waiting = state.waiters.get(projectId);
  if (!waiting) return;
  state.waiters.delete(projectId);
  for (const w of waiting) w();
}

/** A slot for a new run; false at the limit. */
export function reserve(projectId: string, id: string, abort: AbortController): boolean {
  const runs = state.live.get(projectId) ?? new Map<string, AbortController>();
  if (runs.size >= MAX_ACTIVE_SUBAGENTS) return false;
  runs.set(id, abort);
  state.live.set(projectId, runs);
  return true;
}

export function release(projectId: string, id: string): void {
  const runs = state.live.get(projectId);
  if (!runs?.delete(id)) return;
  if (runs.size === 0) state.live.delete(projectId);
  wake(projectId);
}

export function liveCount(projectId: string): number {
  return state.live.get(projectId)?.size ?? 0;
}

/** Stops one run (its card's ■). True when it was running here. */
export function stop(id: string): boolean {
  for (const runs of state.live.values()) {
    const abort = runs.get(id);
    if (abort) {
      abort.abort();
      return true;
    }
  }
  return false;
}

/** Stops every run of a project (it is being deleted); how many. */
export function stopProject(projectId: string): number {
  const runs = [...(state.live.get(projectId)?.values() ?? [])];
  for (const abort of runs) abort.abort();
  return runs.length;
}

export function queueNotice(projectId: string, n: QueuedNotice): void {
  const queue = state.notices.get(projectId) ?? [];
  queue.push(n);
  state.notices.set(projectId, queue);
  wake(projectId);
}

export function takeNotices(projectId: string): QueuedNotice[] {
  const queue = state.notices.get(projectId) ?? [];
  state.notices.delete(projectId);
  return queue;
}

/** For a turn with nobody watching: until a notice is waiting, or no child of the project is left (or its ■). */
export function waitForNoticeOrIdle(projectId: string, signal?: AbortSignal): Promise<"notice" | "idle"> {
  const now = (): "notice" | "idle" | null =>
    (state.notices.get(projectId)?.length ?? 0) > 0 ? "notice" : liveCount(projectId) === 0 || signal?.aborted ? "idle" : null;
  const ready = now();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const check = () => {
      const r = now();
      if (r) {
        signal?.removeEventListener("abort", check);
        resolve(r);
        return;
      }
      const waiting = state.waiters.get(projectId) ?? new Set();
      waiting.add(check);
      state.waiters.set(projectId, waiting);
    };
    signal?.addEventListener("abort", () => {
      state.waiters.get(projectId)?.delete(check);
      resolve("idle");
    }, { once: true });
    check();
  });
}

/** A server turn carrying notices is queued and hasn't started: another one would only find them taken. */
export function noticeTurnPending(projectId: string): boolean {
  return state.noticeTurns.has(projectId);
}

export function setNoticeTurnPending(projectId: string, pending: boolean): void {
  if (pending) state.noticeTurns.add(projectId);
  else state.noticeTurns.delete(projectId);
}

/** For tests: forget everything. */
export function forgetAllSubagents(): void {
  state.live.clear();
  state.notices.clear();
  state.waiters.clear();
  state.noticeTurns.clear();
}
