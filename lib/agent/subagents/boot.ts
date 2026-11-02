// AT BOOT, WHAT THE PREVIOUS PROCESS LEFT (spec local 2026-11-01-subagentes-de-len, §4.7): a deploy kills the
// children that were running, and with them the notices they would have left. Each `running` row closes as
// `aborted`, and every notice that never reached Len (these, and any settled one whose notice was lost) goes to
// him in one server turn per project — as DeepSeek's harness tells the parent about a child that ended.
//
// Pure: instrumentation.ts hands it the real store and `launchSubagentNoticeTurn`.

import { settlementNotice, type SubagentStopReason } from "./notice";
import type { SubagentRunRow } from "./store";
import type * as store from "./store";

/** Older than this, a notice is closed without waking Len: a turn about it would surprise (as `@Len` requests). */
const TELL_UP_TO_MS = 24 * 3_600_000;
const RESTART = "stopped by a restart";

export interface BootIO {
  readonly store: Pick<typeof store, "runningRuns" | "settleRun" | "markNoticeDelivered" | "undeliveredSettledRuns">;
  launchNoticeTurn(o: { projectId: string; personId: string; notices: { id: string; text: string }[] }): void;
  now(): number;
  /** When this process started: what it launched since is its own (running, or its notice still queued). */
  readonly startedAt: number;
}

/** How many notices it handed to Len. */
export async function closeSubagentsOfThePreviousProcess(io: BootIO): Promise<number> {
  const previous = (r: SubagentRunRow) => r.createdAt.getTime() < io.startedAt;
  for (const r of (await io.store.runningRuns()).filter(previous)) {
    await io.store.settleRun(r.id, {
      status: "aborted",
      finalText: "",
      diagnostic: RESTART,
      transcript: r.transcript,
      actions: r.actions,
      usage: r.usage,
      toolUses: r.toolUses,
      durationMs: Math.max(0, io.now() - r.createdAt.getTime()),
      chargedCenticredits: r.chargedCenticredits,
    });
  }
  const byProject = new Map<string, SubagentRunRow[]>();
  for (const r of (await io.store.undeliveredSettledRuns()).filter(previous)) {
    byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  }
  let told = 0;
  for (const [projectId, runs] of byProject) {
    runs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const notices: { id: string; text: string }[] = [];
    let personId = "";
    for (const r of runs) {
      // Marked before the turn is launched: a failure after that loses the notice rather than repeating it.
      if (!(await io.store.markNoticeDelivered(r.id))) continue;
      if (io.now() - (r.settledAt?.getTime() ?? io.now()) > TELL_UP_TO_MS) continue;
      notices.push({
        id: r.id,
        text: settlementNotice({ id: r.id, stopReason: r.status as SubagentStopReason, closingText: r.finalText ?? "", ...(r.diagnostic ? { diagnostic: r.diagnostic } : {}) }),
      });
      personId = r.personId;
    }
    if (notices.length === 0) continue;
    io.launchNoticeTurn({ projectId, personId, notices });
    told += notices.length;
  }
  return told;
}
