// THE PASS (spec local 2026-11-06-asistente-propio, §4.3.2, §6.5): every five minutes, inside the Next process like
// Len's scheduler (lib/scheduled-tasks/scheduler.ts), the pairs whose oldest waiting request is ten minutes old get
// their grouping turn (./grouper.ts) — twenty at most, one after another, one failing never stopping the others — and
// once a day what is 90 days quiet is forgotten. A pass never overlaps the one before. OPENLEN_ASSISTANT=0 starts none.
import { assistantsEnabled } from "../enabled";
import { GROUP_ASLEEP_RETRY_MS, GROUP_FAILED_RETRY_MS, GROUP_PASS_MS, GROUP_QUIET_MS, GROUPS_PER_PASS } from "./limits";

const DAY_MS = 86_400_000;

export interface PassDeps {
  now(): Date;
  pendingGroups(quietBefore: Date, limit: number, now: Date): Promise<{ assistantId: string; projectId: string }[]>;
  groupOne(pair: { assistantId: string; projectId: string }): Promise<"grouped" | "asleep" | "failed" | "nothing">;
  pruneRequests(now: Date): Promise<void>;
  /** An asleep or failing pair steps aside, so the oldest pairs can't fill every pass (final review I2). */
  deferGroup(pair: { assistantId: string; projectId: string }, until: Date): Promise<void>;
  /** Cards a restart cut before their turn started wait again (final review I3); how many. */
  reopenInterrupted(before: Date): Promise<number>;
}

export interface PassState {
  running: boolean;
  /** When this process last pruned, in ms; 0 = never. */
  lastPrune: number;
  /** When this process started: what was accepted before it and never started was cut by the restart. */
  readonly bootAt: Date;
  /** The first pass put those back. */
  reopened: boolean;
}

/** This process's start, not this module's load: a card accepted in the seconds before the pass loads is this process's. */
const processStart = () => new Date(Date.now() - process.uptime() * 1000);

export function newPassState(bootAt: Date = processStart()): PassState {
  return { running: false, lastPrune: 0, bootAt, reopened: false };
}

/** One pass: how many pairs were grouped. A pass while another runs does nothing. */
export async function groupingPass(deps: PassDeps, state: PassState): Promise<number> {
  if (state.running) return 0;
  state.running = true;
  try {
    const now = deps.now();
    if (!state.reopened) {
      state.reopened = true;
      const n = await deps.reopenInterrupted(state.bootAt).catch((err: unknown) => (console.error("[assistant-requests] cut presses couldn't be put back", err), 0));
      if (n > 0) console.log(`[assistant-requests] ${n} card(s) a restart cut wait for their owner again`);
    }
    let grouped = 0;
    const pairs = await deps.pendingGroups(new Date(now.getTime() - GROUP_QUIET_MS), GROUPS_PER_PASS, now);
    const stepAside = (pair: { assistantId: string; projectId: string }, ms: number) =>
      deps.deferGroup(pair, new Date(now.getTime() + ms)).catch((err: unknown) => console.error("[assistant-requests] a pair couldn't step aside", err));
    for (const pair of pairs) {
      try {
        const outcome = await deps.groupOne(pair);
        if (outcome === "grouped") grouped++;
        else if (outcome === "asleep") await stepAside(pair, GROUP_ASLEEP_RETRY_MS);
        else if (outcome === "failed") await stepAside(pair, GROUP_FAILED_RETRY_MS);
      } catch (err) {
        // Its requests wait, with no attempt added; meanwhile the others get their turn.
        console.error(`[assistant-requests] grouping ${pair.assistantId}/${pair.projectId} failed`, err);
        await stepAside(pair, GROUP_FAILED_RETRY_MS);
      }
    }
    if (now.getTime() - state.lastPrune >= DAY_MS) {
      state.lastPrune = now.getTime();
      await deps.pruneRequests(now).catch((err: unknown) => console.error("[assistant-requests] pruning failed", err));
    }
    return grouped;
  } finally {
    state.running = false;
  }
}

async function defaultPassDeps(): Promise<PassDeps> {
  const [store, { groupOne }] = await Promise.all([import("./store"), import("./grouper")]);
  return { now: () => new Date(), pendingGroups: store.pendingGroups, groupOne: (pair) => groupOne(pair), pruneRequests: store.pruneRequests, deferGroup: store.deferGroup, reopenInterrupted: store.reopenInterruptedCards };
}

let started: { stop(): void } | null = null;

/** Once per process, from instrumentation.ts: a first pass now, then one every five minutes. */
export function startRequestGrouper(o: { env?: Readonly<Record<string, string | undefined>>; deps?: PassDeps } = {}): { stop(): void } {
  if (!assistantsEnabled(o.env)) return { stop() {} };
  if (started) return started;
  const state = newPassState();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  void (o.deps ? Promise.resolve(o.deps) : defaultPassDeps())
    .then(async (deps) => {
      if (stopped) return;
      const pass = async () => {
        try {
          const n = await groupingPass(deps, state);
          if (n > 0) console.log(`[assistant-requests] grouped what visitors asked for in ${n} place(s)`);
        } catch (err) {
          console.error("[assistant-requests] pass failed", err);
        }
      };
      await pass();
      if (stopped) return;
      timer = setInterval(() => void pass(), GROUP_PASS_MS);
      timer.unref?.();
    })
    .catch((err) => console.error("[assistant-requests] the grouper could not start", err));
  return (started = {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  });
}
