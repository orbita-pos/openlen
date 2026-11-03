// AT BOOT, WHAT THE PREVIOUS PROCESS LEFT (spec local 2026-11-01-subagentes-de-len, §4.7): a deploy kills the
// children that were running, and with them the notices they would have left. Each `running` row closes as
// `aborted`, and every notice that never reached Len (these, and any settled one whose notice was lost) goes to
// him in one server turn per project — as DeepSeek's harness tells the parent about a child that ended.
//
// Pure: instrumentation.ts hands it the real store and `launchSubagentNoticeTurn`.

import { settlementNotice, type SubagentStopReason, type WorktreeOutcome } from "./notice";
import type { SubagentRunRow } from "./store";
import type * as store from "./store";

/** Older than this, a notice is closed without waking Len: a turn about it would surprise (as `@Len` requests). */
const TELL_UP_TO_MS = 24 * 3_600_000;
const RESTART = "stopped by a restart";

export interface BootIO {
  finishWorktree(r: SubagentRunRow): Promise<WorktreeOutcome | null>;
  readonly store: Pick<typeof store, "runningRuns" | "settleRun" | "markNoticeDelivered" | "undeliveredSettledRuns" | "unfinishedWorktreeRuns">;
  launchNoticeTurn(o: { projectId: string; personId: string; notices: { id: string; text: string }[] }): void;
  /** A previous process's child this one woke is working here: it is not the restart's. */
  isLive(projectId: string, id: string): boolean;
  now(): number;
  /** When this process started: what it launched since is its own (running, or its notice still queued). */
  readonly startedAt: number;
}

/** How many notices it handed to Len. */
export async function closeSubagentsOfThePreviousProcess(io: BootIO): Promise<number> {
  const previous = (r: SubagentRunRow) => r.createdAt.getTime() < io.startedAt;
  const closedHere = new Set<string>();
  for (const r of (await io.store.runningRuns()).filter((r) => previous(r) && !io.isLive(r.projectId, r.id))) {
    await io.store.settleRun(r.id, {
      status: "aborted",
      // What it told Len before (a woken run) stays on its card; the notice below says it left nothing new.
      finalText: r.finalText ?? "",
      diagnostic: RESTART,
      transcript: r.transcript,
      actions: r.actions,
      usage: r.usage,
      toolUses: r.toolUses,
      // Its progress keeps the time it worked; without any, since it started.
      durationMs: r.durationMs ?? Math.max(0, io.now() - r.createdAt.getTime()),
      chargedCenticredits: r.chargedCenticredits,
    });
    closedHere.add(r.id);
  }
  // A previous run settled after this process started was settled here (woken), and its notice is queued here.
  const owed = (r: SubagentRunRow) => previous(r) && (closedHere.has(r.id) || (r.settledAt?.getTime() ?? 0) < io.startedAt);
  const recovered = new Map<string, WorktreeOutcome | null>();
  for (const r of (await io.store.unfinishedWorktreeRuns()).filter(r => owed(r) && !io.isLive(r.projectId, r.id))) {
    recovered.set(r.id, await io.finishWorktree(r));
  }
  const byProject = new Map<string, SubagentRunRow[]>();
  for (const r of (await io.store.undeliveredSettledRuns()).filter(owed)) {
    byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  }
  let told = 0;
  for (const [projectId, runs] of byProject) {
    runs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const notices: { id: string; text: string }[] = [];
    let personId = "";
    for (const r of runs) {
      const worktree = recovered.has(r.id) ? recovered.get(r.id) : r.worktreeOutcome;
      // Marked before the turn is launched: a failure after that loses the notice rather than repeating it.
      if (!(await io.store.markNoticeDelivered(r.id))) continue;
      if (io.now() - (r.settledAt?.getTime() ?? io.now()) > TELL_UP_TO_MS) continue;
      notices.push({
        id: r.id,
        text: settlementNotice({
          id: r.id,
          stopReason: r.status as SubagentStopReason,
          closingText: r.diagnostic === RESTART ? "" : (r.finalText ?? ""),
          ...(r.diagnostic ? { diagnostic: r.diagnostic } : {}),
          ...(worktree ? { worktree } : {}),
        }),
      });
      personId = r.personId;
    }
    if (notices.length === 0) continue;
    io.launchNoticeTurn({ projectId, personId, notices });
    told += notices.length;
  }
  return told;
}
