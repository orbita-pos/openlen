// ONE BOX PER PROJECT, SHARED (spec local 2026-11-01-subagentes-de-len, §4.8): the turn and its subagents —
// and a later turn while they still run — use the same E2B box, as Claude Code's and DeepSeek's children
// share their parent's working directory. Whoever joins first opens it; it is paused, let go and charged
// (choose.ts, `close`) only when its last holder leaves. Commands on one box go one at a time, so what each
// one syncs back is its own.
//
// In-process, on `globalThis` like exit-flush.ts: the agent route and the subagents' launcher are different
// bundles. Supposes ONE Next process, like the project's turn queue.

import type { TurnSandbox } from "./choose";

interface Lease {
  readonly box: TurnSandbox;
  readonly holders: string[];
  /** The holders that are subagents. */
  readonly subagents: Set<string>;
}

interface State {
  readonly leases: Map<string, Lease>;
  /** A project whose box is being opened: whoever comes meanwhile waits for it instead of opening another. */
  readonly opening: Map<string, Promise<TurnSandbox | null>>;
  readonly locks: WeakMap<TurnSandbox, Promise<unknown>>;
}

const KEY = Symbol.for("openlen.sandbox.projectLease");
type Global = typeof globalThis & { [KEY]?: State };
const state: State = ((globalThis as Global)[KEY] ??= { leases: new Map(), opening: new Map(), locks: new WeakMap() });

/**
 * The project's box: the one already open (joined), or `open()`'s. `null` when it could not open, or when it
 * is open and can't be shared; nothing is kept then. It is shared with subagents only: a subagent joins, and
 * anyone joins while a subagent is in it (a later turn while they still run); two plain turns of one project
 * still don't share it, as before.
 */
export async function joinBox(
  projectId: string,
  holderId: string,
  open: () => Promise<TurnSandbox | null>,
  o: { readonly subagent?: boolean } = {},
): Promise<TurnSandbox | null> {
  const join = (lease: Lease): TurnSandbox | null => {
    if (!lease.holders.includes(holderId)) {
      if (!o.subagent && lease.subagents.size === 0) return null;
      lease.holders.push(holderId);
      if (o.subagent) lease.subagents.add(holderId);
    }
    return lease.box;
  };
  const current = state.leases.get(projectId);
  if (current) return join(current);
  const pending = state.opening.get(projectId);
  if (pending) {
    await pending.catch(() => null);
    const opened = state.leases.get(projectId);
    if (opened) return join(opened);
  }
  const opening = open();
  state.opening.set(projectId, opening);
  try {
    const box = await opening;
    if (!box) return null;
    const lease: Lease = { box, holders: [holderId], subagents: new Set(o.subagent ? [holderId] : []) };
    state.leases.set(projectId, lease);
    return box;
  } finally {
    if (state.opening.get(projectId) === opening) state.opening.delete(projectId);
  }
}

/** One holder leaves; the last one closes the box. A holder that never joined changes nothing. */
export async function leaveBox(projectId: string, holderId: string, close: (box: TurnSandbox) => Promise<void>): Promise<void> {
  const lease = state.leases.get(projectId);
  if (!lease) return;
  const i = lease.holders.indexOf(holderId);
  if (i === -1) return;
  lease.holders.splice(i, 1);
  lease.subagents.delete(holderId);
  if (lease.holders.length > 0) return;
  state.leases.delete(projectId);
  await close(lease.box);
}

export function boxHolders(projectId: string): readonly string[] {
  return [...(state.leases.get(projectId)?.holders ?? [])];
}

/** Whether `holderId` holds the project's box. */
export function holdsBox(projectId: string, holderId: string): boolean {
  return state.leases.get(projectId)?.holders.includes(holderId) ?? false;
}

/** One command at a time per box; a failed one does not keep it locked. */
export function withBoxLock<T>(box: TurnSandbox, fn: () => Promise<T>): Promise<T> {
  const before = state.locks.get(box) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(fn);
  state.locks.set(box, run.catch(() => undefined));
  return run;
}

/** Takes the box's turn and holds it until the returned function is called (a whole `bash` call: bring the
 *  box up to date, run, save what it changed). */
export async function lockBox(box: TurnSandbox): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const inside = new Promise<void>((r) => (entered = r));
  void withBoxLock(box, async () => {
    entered();
    await held;
  });
  await inside;
  return release;
}

/** For tests: forget every lease. */
export function forgetAllBoxes(): void {
  state.leases.clear();
  state.opening.clear();
}
