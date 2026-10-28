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
// This only closes. What the next turn reads of a cut row —what Len saw, and Claude Code's
// interruption mark— is lib/agent/transcripcion.ts's; the thread and email requests a restart left
// unanswered are retaken by turnos-desde-el-servidor.ts and len-email/run.ts.
import "server-only";

import { releaseHoldsFromBeforeBoot } from "@/lib/agent/sandbox/store";
import { cutOffRowsOpenedBeforeBoot } from "@/lib/projects/chat";

export interface DeadTurnStore {
  cutOffRows(secondsSinceBoot: number): Promise<number>;
  releaseHolds(secondsSinceBoot: number): Promise<number>;
}

const postgresStore: DeadTurnStore = {
  cutOffRows: cutOffRowsOpenedBeforeBoot,
  releaseHolds: releaseHoldsFromBeforeBoot,
};

/** Never throws: booting must not fail for this, and each half runs even if the other fails. Without
 *  `E2B_API_KEY` no turn holds a box, so there is nothing to release (and the table may not exist). */
export async function closeTurnsOfThePreviousProcess(
  o: {
    readonly secondsSinceBoot?: () => number;
    readonly store?: DeadTurnStore;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly log?: (line: string) => void;
  } = {},
): Promise<{ rows: number; holds: number }> {
  const store = o.store ?? postgresStore;
  const uptime = o.secondsSinceBoot ?? (() => process.uptime());
  const log = o.log ?? ((line: string) => console.info(line));
  const env = o.env ?? process.env;
  const rows = await store.cutOffRows(uptime()).catch((e: unknown) => {
    log(`[dead-turns] could not cut off the previous process's turn rows: ${message(e)}`);
    return 0;
  });
  const holds = env.E2B_API_KEY
    ? await store.releaseHolds(uptime()).catch((e: unknown) => {
        log(`[dead-turns] could not release the previous process's box holds: ${message(e)}`);
        return 0;
      })
    : 0;
  if (rows > 0 || holds > 0) log(`[dead-turns] the previous process left ${rows} turn row(s) cut off and ${holds} box hold(s) released`);
  return { rows, holds };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
