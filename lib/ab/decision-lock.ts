// HOLDING A DECISION'S LOCK WHILE IT RUNS (review: stale-lock recovery).
//
// A decision (promote, keep A, «Seguir probando», the harm brake, «Stop and publish») claims the experiment, then publishes —
// and a publish localizes every language, copies Stripe twins and deploys Functions: it can take more than the ten minutes
// after which the evaluator's sweep calls a lock dead. So the claim carries a TOKEN, the decision refreshes the lock's clock
// every minute under it (`heartbeatDecisionLock`, only while the row is still its own), and its closing write is FENCED on it
// (`closeDecision`): a lock the sweep did give back, and that another decision took, can't be written over by the one that
// lost it. A «stale» lock is now what the word says — not refreshed for ten minutes.
import "server-only";

import { closeDecision, heartbeatDecisionLock, releaseDecisionLock, type AbExperimentRow } from "./store";

/** How often a running decision says it is alive. The sweep's threshold is ten minutes: ten missed beats. */
export const HEARTBEAT_MS = 60_000;

export type ClosePatch = Parameters<typeof closeDecision>[2];

export interface LockDeps {
  heartbeat(id: string, token: string): Promise<boolean>;
  close(id: string, token: string | null, patch: ClosePatch): Promise<AbExperimentRow | null>;
  release(id: string, token: string | null): Promise<void>;
  readonly everyMs: number;
}

const realDeps: LockDeps = {
  heartbeat: (id, token) => heartbeatDecisionLock(id, token),
  close: closeDecision,
  release: (id, token) => releaseDecisionLock(id, token),
  everyMs: HEARTBEAT_MS,
};

export interface HeldDecision {
  /** The claimed row (its `decisionLockToken` is this decision's). */
  readonly row: AbExperimentRow;
  /** The closing write, fenced. `null` = the lock was lost: nothing was written, and it said so. */
  close(patch: ClosePatch): Promise<AbExperimentRow | null>;
  /** The decision failed: give the lock back as it was — only if it is still this one's. Never throws. */
  release(): Promise<void>;
  /** Stop the heartbeat (always, in a `finally`). */
  stop(): void;
}

/** Starts the heartbeat for a claimed row. The caller must `stop()` it. */
export function holdDecision(row: AbExperimentRow, deps: LockDeps = realDeps): HeldDecision {
  const token = row.decisionLockToken;
  let timer: ReturnType<typeof setInterval> | null = null;
  if (token) {
    timer = setInterval(() => {
      void deps
        .heartbeat(row.id, token)
        .then((alive) => {
          if (!alive) console.warn(`[ab] the decision on ${row.id} no longer holds its lock`);
        })
        .catch((err: unknown) => console.warn(`[ab] couldn't refresh the decision lock of ${row.id}`, err));
    }, deps.everyMs);
    timer.unref?.();
  }
  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  return {
    row,
    close: (patch) => deps.close(row.id, token, patch),
    release: async () => {
      stop();
      await deps.release(row.id, token).catch((err: unknown) => {
        console.error("[ab] couldn't give a decision lock back; the evaluator's sweep will", row.id, err);
      });
    },
    stop,
  };
}
