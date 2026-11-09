// THE PASS (spec local 2026-11-06-asistente-propio, §4.3.2, §6.5): every five minutes, inside the Next process like
// Len's scheduler (lib/scheduled-tasks/scheduler.ts), the pairs whose oldest waiting request is ten minutes old get
// their grouping turn (./grouper.ts) — twenty at most, one after another, one failing never stopping the others — and
// once a day what is 90 days quiet is forgotten. A pass never overlaps the one before. OPENLEN_ASSISTANT=0 starts none.
import { assistantsEnabled } from "../enabled";
import { GROUP_PASS_MS, GROUP_QUIET_MS, GROUPS_PER_PASS } from "./limits";

const DAY_MS = 86_400_000;

export interface PassDeps {
  now(): Date;
  pendingGroups(quietBefore: Date, limit: number): Promise<{ assistantId: string; projectId: string }[]>;
  groupOne(pair: { assistantId: string; projectId: string }): Promise<"grouped" | "asleep" | "nothing">;
  pruneRequests(now: Date): Promise<void>;
}

export interface PassState {
  running: boolean;
  /** When this process last pruned, in ms; 0 = never. */
  lastPrune: number;
}

export function newPassState(): PassState {
  return { running: false, lastPrune: 0 };
}

/** One pass: how many pairs were grouped. A pass while another runs does nothing. */
export async function groupingPass(deps: PassDeps, state: PassState): Promise<number> {
  if (state.running) return 0;
  state.running = true;
  try {
    const now = deps.now();
    let grouped = 0;
    const pairs = await deps.pendingGroups(new Date(now.getTime() - GROUP_QUIET_MS), GROUPS_PER_PASS);
    for (const pair of pairs) {
      try {
        if ((await deps.groupOne(pair)) === "grouped") grouped++;
      } catch (err) {
        // Its requests wait for the next pass, with no attempt added.
        console.error(`[assistant-requests] grouping ${pair.assistantId}/${pair.projectId} failed`, err);
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
  return { now: () => new Date(), pendingGroups: store.pendingGroups, groupOne: (pair) => groupOne(pair), pruneRequests: store.pruneRequests };
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
