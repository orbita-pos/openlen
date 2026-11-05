// At boot, what the previous process left mid-turn.
//
// A deploy or a crash kills the app while turns run: their `finally` never runs, so their rows stay
// «en curso» and their E2B boxes stay held. The chat closes such a row when someone looks at it again
// (the reattach, GET /api/agent/turno/[fila]); a turn nobody watches — a thread's `@Len`, an email, a
// goal's round — stayed «en curso» and out of the next turn's history, and its box stayed held for two
// hours (STALE_HOLD), so the project's turns fell back to the old terminal. DeepSeek closes an
// interrupted log when it resumes it, holding its write handle (`interruptedTurnClosers`); with ONE
// Next process, booting is when this process holds every turn.
//
// A box is closed the way its turn would have closed it (choose.ts, `close`): paused, let go, and charged
// to the owner for the seconds it ran — until this boot, the closest to the turn's death the database
// knows. A box that ran is never free (billing.ts); E2B would otherwise keep it running, at OpenLen's
// cost, until its 15-minute timeout. A deploy's SIGTERM usually spares this: the turn closes its own box
// before the exit (exit-flush.ts), to the second; what reaches here is what died at once (a crash, a kill).
//
// A TOOL'S JOB (lib/tools/jobs/, spec local 2026-11-04-herramientas-hechas-por-len, §4.6) holds the tool project's box
// as `job-<id>` outside any turn: its box is closed the same way but charged to the job's PERSON — who pressed «Ejecutar»
// and pays it — never the project's owner, and then its row ends `failed` once («stopped_by_restart»).
//
// This only closes. What the next turn reads of a cut row —what Len saw, and Claude Code's
// interruption mark— is lib/agent/transcripcion.ts's; the thread and email requests a restart left
// unanswered are retaken by turnos-desde-el-servidor.ts and len-email/run.ts.
import "server-only";

import { randomUUID } from "node:crypto";

import { chargeSandbox } from "@/lib/agent/sandbox/billing";
import type { SandboxDriver } from "@/lib/agent/sandbox/driver";
import { isNotFound, sandboxCleanupDriver } from "@/lib/agent/sandbox/reaper";
import { releasePausedBox, releaseProjectSandbox, takeOverHoldsFromBeforeBoot, type DeadHold } from "@/lib/agent/sandbox/store";
import { cutOffRowsOpenedBeforeBoot } from "@/lib/projects/chat";
import { JOB_BOX_CLEANUP } from "@/lib/tools/jobs/command";

export interface DeadTurnStore {
  cutOffRows(secondsSinceBoot: number): Promise<number>;
  takeOverHolds(secondsSinceBoot: number, token: string): Promise<DeadHold[]>;
  /** The box is paused: the row says so and lets it go. */
  releasePaused(projectId: string, token: string): Promise<void>;
  release(projectId: string, token: string): Promise<void>;
  /** Who a tool's job is for (its box's payer) and the most it may be charged; null when the row is gone. */
  jobPayer?(jobId: string): Promise<{ personId: string; maxSeconds: number } | null>;
  /** Ends the live jobs from before this boot `failed`, with what the boot charged each one's box. */
  settleJobs?(secondsSinceBoot: number, charged: ReadonlyMap<string, { seconds: number; centicredits: number }>): Promise<number>;
}

/** A tool's job holds a box as its own id (lib/tools/jobs/types.ts, `newJobId`). */
const JOB_HOLDER = /^job-[0-9a-f]{16}$/;

const postgresStore: DeadTurnStore = {
  cutOffRows: cutOffRowsOpenedBeforeBoot,
  takeOverHolds: takeOverHoldsFromBeforeBoot,
  releasePaused: releasePausedBox,
  release: releaseProjectSandbox,
  jobPayer: async (jobId) => (await import("@/lib/tools/jobs/store")).jobPayerOf(jobId),
  settleJobs: async (secondsSinceBoot, charged) => (await import("@/lib/tools/jobs/boot")).settleJobsOfThePreviousProcess(secondsSinceBoot, charged),
};

type Charge = typeof chargeSandbox;

/** How the boot's holds start: one per boot, while it pauses the dead turns' boxes. */
export const BOOT_HOLD_PREFIX = "boot-";

/** Never throws: booting must not fail for this, and each half runs even if the other fails. Without
 *  `E2B_API_KEY` no turn holds a box, so there is nothing to release (and the table may not exist). */
export async function closeTurnsOfThePreviousProcess(
  o: {
    readonly secondsSinceBoot?: () => number;
    readonly store?: DeadTurnStore;
    readonly driver?: SandboxDriver | null;
    readonly charge?: Charge;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly log?: (line: string) => void;
  } = {},
): Promise<{ rows: number; holds: number; paused: number; centicredits: number; jobs: number }> {
  const store = o.store ?? postgresStore;
  const uptime = o.secondsSinceBoot ?? (() => process.uptime());
  const log = o.log ?? ((line: string) => console.info(line));
  const env = o.env ?? process.env;
  const rows = await store.cutOffRows(uptime()).catch((e: unknown) => {
    log(`[dead-turns] could not cut off the previous process's turn rows: ${message(e)}`);
    return 0;
  });
  const charged = new Map<string, { seconds: number; centicredits: number }>();
  const boxes = env.E2B_API_KEY
    ? await closeDeadBoxes(store, uptime(), o.driver === undefined ? sandboxCleanupDriver(env) : o.driver, o.charge ?? chargeSandbox, log, charged)
    : { holds: 0, paused: 0, centicredits: 0 };
  // After the boxes, so each job's row says what its box ran and cost. Without E2B there is no job to close, but the
  // rows are cheap to look at (and the table may not exist yet: that is only logged).
  const jobs = store.settleJobs
    ? await store.settleJobs(uptime(), charged).catch((e: unknown) => {
        log(`[dead-turns] could not close the previous process's tool jobs: ${message(e)}`);
        return 0;
      })
    : 0;
  if (rows > 0 || boxes.holds > 0 || jobs > 0) {
    log(
      `[dead-turns] the previous process left ${rows} turn row(s) cut off${jobs > 0 ? `, ${jobs} tool job(s) stopped` : ""} and ${boxes.holds} box hold(s) released` +
        ` (${boxes.paused} paused, ${boxes.centicredits} centicredits charged)`,
    );
  }
  return { rows, ...boxes, jobs };
}

async function closeDeadBoxes(
  store: DeadTurnStore,
  secondsSinceBoot: number,
  driver: SandboxDriver | null,
  charge: Charge,
  log: (line: string) => void,
  charged: Map<string, { seconds: number; centicredits: number }>,
): Promise<{ holds: number; paused: number; centicredits: number }> {
  const token = `${BOOT_HOLD_PREFIX}${randomUUID()}`;
  let dead: DeadHold[];
  try {
    dead = await store.takeOverHolds(secondsSinceBoot, token);
  } catch (e) {
    log(`[dead-turns] could not release the previous process's box holds: ${message(e)}`);
    return { holds: 0, paused: 0, centicredits: 0 };
  }
  let paused = 0;
  let centicredits = 0;
  for (const h of dead) {
    let isPaused = false;
    const isJob = JOB_HOLDER.test(h.turnId);
    // A job's processes were frozen with the box, and its folder holds the person's picked files: the box is opened
    // (with no network but its own list) only to stop them and remove it, then paused — never left for Len's next turn.
    if (isJob && h.sandboxId && driver) {
      try {
        const box = await driver.resume(h.sandboxId, { hosts: [], headers: {} });
        await box.run(JOB_BOX_CLEANUP, { timeoutMs: 15_000 });
        await box.pause();
        isPaused = true;
      } catch (e) {
        if (!isNotFound(e)) log(`[dead-turns] could not clean the job's box ${h.sandboxId} project=${h.projectId}: ${message(e)}`);
      }
    }
    if (!isPaused && h.sandboxId && driver) {
      try {
        await driver.pause(h.sandboxId);
        isPaused = true;
      } catch (e) {
        // Gone (reclaimed, killed): nothing runs, and the next turn makes a new one. Anything else: E2B pauses it
        // at its timeout.
        if (!isNotFound(e)) log(`[dead-turns] could not pause ${h.sandboxId} project=${h.projectId}: ${message(e)}`);
      }
    }
    await (isPaused ? store.releasePaused(h.projectId, token) : store.release(h.projectId, token)).catch((e: unknown) =>
      log(`[dead-turns] could not let go of the box of project=${h.projectId}: ${message(e)}`),
    );
    if (isPaused) paused++;
    // A job's box is its person's, never past the job's ceiling (what the confirmation showed); a job whose row is
    // gone charges nobody (never the project's owner).
    const job = isJob ? await (store.jobPayer?.(h.turnId) ?? Promise.resolve(null)).catch(() => null) : null;
    const payer = isJob ? (job?.personId ?? null) : h.ownerId;
    const seconds = job && job.maxSeconds > 0 ? Math.min(h.secondsRun, job.maxSeconds) : h.secondsRun;
    if (payer && seconds > 0) {
      const moved = await charge({ userId: payer, actorId: null, projectId: h.projectId, turnId: h.turnId, seconds }).catch(
        (e: unknown) => {
          log(`[dead-turns] could not charge the box of project=${h.projectId}: ${message(e)}`);
          return 0;
        },
      );
      centicredits += moved;
      if (isJob) charged.set(h.turnId, { seconds, centicredits: moved });
    }
  }
  return { holds: dead.length, paused, centicredits };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
