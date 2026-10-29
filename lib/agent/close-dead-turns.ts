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

export interface DeadTurnStore {
  cutOffRows(secondsSinceBoot: number): Promise<number>;
  takeOverHolds(secondsSinceBoot: number, token: string): Promise<DeadHold[]>;
  /** The box is paused: the row says so and lets it go. */
  releasePaused(projectId: string, token: string): Promise<void>;
  release(projectId: string, token: string): Promise<void>;
}

const postgresStore: DeadTurnStore = {
  cutOffRows: cutOffRowsOpenedBeforeBoot,
  takeOverHolds: takeOverHoldsFromBeforeBoot,
  releasePaused: releasePausedBox,
  release: releaseProjectSandbox,
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
): Promise<{ rows: number; holds: number; paused: number; centicredits: number }> {
  const store = o.store ?? postgresStore;
  const uptime = o.secondsSinceBoot ?? (() => process.uptime());
  const log = o.log ?? ((line: string) => console.info(line));
  const env = o.env ?? process.env;
  const rows = await store.cutOffRows(uptime()).catch((e: unknown) => {
    log(`[dead-turns] could not cut off the previous process's turn rows: ${message(e)}`);
    return 0;
  });
  const boxes = env.E2B_API_KEY
    ? await closeDeadBoxes(store, uptime(), o.driver === undefined ? sandboxCleanupDriver(env) : o.driver, o.charge ?? chargeSandbox, log)
    : { holds: 0, paused: 0, centicredits: 0 };
  if (rows > 0 || boxes.holds > 0) {
    log(
      `[dead-turns] the previous process left ${rows} turn row(s) cut off and ${boxes.holds} box hold(s) released` +
        ` (${boxes.paused} paused, ${boxes.centicredits} centicredits charged)`,
    );
  }
  return { rows, ...boxes };
}

async function closeDeadBoxes(
  store: DeadTurnStore,
  secondsSinceBoot: number,
  driver: SandboxDriver | null,
  charge: Charge,
  log: (line: string) => void,
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
    if (h.sandboxId && driver) {
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
    if (h.ownerId && h.secondsRun > 0) {
      centicredits += await charge({ userId: h.ownerId, actorId: null, projectId: h.projectId, turnId: h.turnId, seconds: h.secondsRun }).catch(
        (e: unknown) => {
          log(`[dead-turns] could not charge the box of project=${h.projectId}: ${message(e)}`);
          return 0;
        },
      );
    }
  }
  return { holds: dead.length, paused, centicredits };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
