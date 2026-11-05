// A RESTART NEVER LEAVES A JOB RUNNING (spec local 2026-11-04-herramientas-hechas-por-len, §4.6). A job's runner lives
// in the Next process: a deploy's SIGTERM closes it through the exit flush (the runner's own `onExit`), and what dies
// at once — a crash, a kill — is closed at the next boot: close-dead-turns.ts pauses its box, lets it go and charges the
// job's PERSON for what it ran (its holder is the job's id), then this settles the row `failed` once, saying what it
// ran and cost. DeepSeek's registry: settlement is first-wins, so a row its runner settled is left as it is.
import "server-only";

import { liveJobsFromBeforeBoot, settleJob } from "./store";
import { STOPPED_BY_RESTART } from "./types";

export interface JobBootDeps {
  liveFromBeforeBoot(secondsSinceBoot: number): Promise<ReadonlyArray<{ readonly id: string }>>;
  settle(id: string, status: "failed", set: { detail: string; seconds?: number; chargedCentis?: number }): Promise<unknown>;
}

const realDeps: JobBootDeps = { liveFromBeforeBoot: liveJobsFromBeforeBoot, settle: settleJob };

/** Settles every live job from before this boot; `charged` is what the boot charged each job's box. Returns how many. */
export async function settleJobsOfThePreviousProcess(
  secondsSinceBoot: number,
  charged: ReadonlyMap<string, { readonly seconds: number; readonly centicredits: number }>,
  d: JobBootDeps = realDeps,
): Promise<number> {
  const dead = await d.liveFromBeforeBoot(secondsSinceBoot);
  for (const job of dead) {
    const c = charged.get(job.id);
    await d.settle(job.id, "failed", { detail: STOPPED_BY_RESTART, ...(c ? { seconds: Math.round(c.seconds), chargedCentis: c.centicredits } : {}) });
  }
  return dead.length;
}
