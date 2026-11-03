import { describe, expect, it, vi } from "vitest";

import { closeSubagentsOfThePreviousProcess, type BootIO } from "./boot";
import { settlementNotice, worktreeNoticeLine } from "./notice";
import type { SubagentRunRow } from "./store";

const NOW = Date.parse("2026-11-02T10:00:00Z");

function row(o: Partial<SubagentRunRow> & Pick<SubagentRunRow, "id">): SubagentRunRow {
  return {
    projectId: "p1", chatRowId: "row1", turnId: "t1", personId: "u1", preset: "Explore", description: "Find", prompt: "Where?",
    status: "running", transcript: null, actions: [], finalText: null, diagnostic: null, usage: null, toolUses: 0, durationMs: null,
    chargedCenticredits: 0, createdAt: new Date(NOW - 60_000), settledAt: null, noticeDeliveredAt: null, forked: false, planMode: false,
    worktreeCopyId: null, worktreeBranch: null, worktreeBase: null, worktreeOutcome: null,
    ...o,
  };
}

function setup(rows: SubagentRunRow[]) {
  const db = new Map(rows.map((r) => [r.id, { ...r }]));
  const turns: { projectId: string; personId: string; notices: { id: string; text: string }[] }[] = [];
  const io: BootIO = {
    store: {
      runningRuns: async () => [...db.values()].filter((r) => r.status === "running"),
      settleRun: async (id, s) => void db.set(id, { ...db.get(id)!, ...s, settledAt: new Date(NOW) }),
      markNoticeDelivered: async (id) => {
        const r = db.get(id)!;
        if (r.noticeDeliveredAt) return false;
        db.set(id, { ...r, noticeDeliveredAt: new Date(NOW) });
        return true;
      },
      undeliveredSettledRuns: async () => [...db.values()].filter((r) => r.status !== "running" && !r.noticeDeliveredAt),
      unfinishedWorktreeRuns: async () => [...db.values()].filter(r => r.worktreeCopyId && (!r.worktreeOutcome || (r.worktreeOutcome.state === "kept" && r.worktreeOutcome.copyId))),
    },
    launchNoticeTurn: (o) => void turns.push(o),
    isLive: () => false,
    finishWorktree: async () => null,
    now: () => NOW,
    startedAt: NOW - 10_000,
  };
  return { db, turns, io };
}

describe("at boot, what the previous process left", () => {
  it("finishes archived copies without sending their notices to the new conversation", async () => {
    const s = setup([]);
    const archived = row({ id: "old", status: "completed", settledAt: new Date(NOW - 15_000), worktreeCopyId: "copy" });
    const finishWorktree = vi.fn(async (_r: SubagentRunRow) => ({ state: "nothing" } as const));
    await closeSubagentsOfThePreviousProcess({ ...s.io, store: { ...s.io.store, unfinishedWorktreeRuns: async () => [archived] }, finishWorktree });
    expect(finishWorktree).toHaveBeenCalledWith(archived);
    expect(s.turns).toEqual([]);
  });
  it.each(["running", "completed"] as const)("finishes an isolated child's unfinished copy (%s) before its notice", async (status) => {
    const s = setup([row({ id: "r1", status, settledAt: status === "completed" ? new Date(NOW - 15_000) : null,
      worktreeCopyId: "copy", worktreeBranch: "worktree-agent-r1", worktreeBase: "base" })]);
    const outcome = { state: "brought", files: ["/src/a.ts"] } as const;
    const finishWorktree = vi.fn(async (_r: SubagentRunRow) => {
      expect(s.turns).toHaveLength(0);
      return outcome;
    });
    await closeSubagentsOfThePreviousProcess({ ...s.io, finishWorktree });
    expect(finishWorktree).toHaveBeenCalledTimes(1);
    expect(finishWorktree.mock.calls[0]?.[0]).toMatchObject({ id: "r1", projectId: "p1" });
    expect(s.db.get("r1")?.status).toBe(status === "running" ? "aborted" : "completed");
    expect(s.turns[0]?.notices[0]?.text.endsWith(worktreeNoticeLine(outcome)!)).toBe(true);
  });

  it("a copy that can't come back doesn't stop the others nor any notice; its own says the copy was kept", async () => {
    const s = setup([
      row({ id: "r1", projectId: "p1", worktreeCopyId: "c1", worktreeBranch: "worktree-agent-r1", worktreeBase: "b" }),
      row({ id: "r2", projectId: "p2", worktreeCopyId: "c2", worktreeBranch: "worktree-agent-r2", worktreeBase: "b" }),
    ]);
    const finishWorktree = vi.fn(async (r: SubagentRunRow) => {
      if (r.id === "r1") throw new Error("the database went away");
      return { state: "nothing" } as const;
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await closeSubagentsOfThePreviousProcess({ ...s.io, finishWorktree });
    expect(finishWorktree).toHaveBeenCalledTimes(2);
    expect(s.turns.map((t) => t.projectId).sort()).toEqual(["p1", "p2"]);
    // As the launcher does when it can't bring a copy back: kept, and retried at the next startup.
    const kept = worktreeNoticeLine({ state: "kept", branch: "worktree-agent-r1", copyId: "c1" })!;
    expect(s.turns.find((t) => t.projectId === "p1")!.notices[0]!.text.endsWith(kept)).toBe(true);
  });

  it("a row without an unfinished copy is untouched", async () => {
    const s = setup([row({ id: "r1" }), row({ id: "r2", worktreeCopyId: "copy", worktreeOutcome: { state: "nothing" } })]);
    const finishWorktree = vi.fn(async (_r: SubagentRunRow) => null);
    await closeSubagentsOfThePreviousProcess({ ...s.io, finishWorktree });
    expect(finishWorktree).not.toHaveBeenCalled();
  });

  it("boot closes running runs once", async () => {
    const s = setup([row({ id: "r1" }), row({ id: "r2", personId: "u2", createdAt: new Date(NOW - 30_000) })]);
    expect(await closeSubagentsOfThePreviousProcess(s.io)).toBe(2);
    expect(s.db.get("r1")).toMatchObject({ status: "aborted", diagnostic: "stopped by a restart" });
    expect(s.db.get("r2")).toMatchObject({ status: "aborted", diagnostic: "stopped by a restart" });
    // One turn for the project, as the person who launched the last child, with both notices.
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ projectId: "p1", personId: "u2" });
    expect(s.turns[0]!.notices.map((n) => n.id)).toEqual(["r1", "r2"]);
    expect(s.turns[0]!.notices[0]!.text).toContain("Background subagent r1 was stopped before it finished.");

    expect(await closeSubagentsOfThePreviousProcess(s.io)).toBe(0);
    expect(s.turns).toHaveLength(1);
  });

  it("a settled run whose notice never reached Len goes too, with its closing message", async () => {
    const s = setup([row({ id: "r1", status: "completed", finalText: "In /menu/index.html:12.", settledAt: new Date(NOW - 15_000) })]);
    expect(await closeSubagentsOfThePreviousProcess(s.io)).toBe(1);
    expect(s.turns[0]!.notices[0]!.text).toBe("Background subagent r1 finished and will do no further work unless you send it more.\n\nIts closing message:\nIn /menu/index.html:12.");
  });

  it("one from more than a day ago is closed without waking Len", async () => {
    const s = setup([row({ id: "r1", status: "completed", finalText: "old", settledAt: new Date(NOW - 2 * 86_400_000) })]);
    expect(await closeSubagentsOfThePreviousProcess(s.io)).toBe(0);
    expect(s.turns).toHaveLength(0);
    expect(s.db.get("r1")!.noticeDeliveredAt).not.toBeNull();
  });

  it("what this process launched since it started is not touched: running, or with its notice still queued", async () => {
    const s = setup([
      row({ id: "r1", createdAt: new Date(NOW - 5_000) }),
      row({ id: "r2", status: "completed", finalText: "x", createdAt: new Date(NOW - 4_000), settledAt: new Date(NOW - 1_000) }),
    ]);
    expect(await closeSubagentsOfThePreviousProcess(s.io)).toBe(0);
    expect(s.db.get("r1")!.status).toBe("running");
    expect(s.db.get("r2")!.noticeDeliveredAt).toBeNull();
    expect(s.turns).toHaveLength(0);
  });

  it("a previous run this process woke is left alone: live, or settled here with its notice still queued", async () => {
    const s = setup([row({ id: "r1" }), row({ id: "r2", status: "completed", finalText: "Done", settledAt: new Date(NOW - 5_000) })]);
    const io: BootIO = { ...s.io, isLive: (_projectId, id) => id === "r1" };
    expect(await closeSubagentsOfThePreviousProcess(io)).toBe(0);
    expect(s.db.get("r1")!.status).toBe("running");
    expect(s.db.get("r2")!.noticeDeliveredAt).toBeNull();
    expect(s.turns).toEqual([]);
  });

  it("a run cut by the restart keeps the time it had worked and what it told Len before; its notice has no closing message", async () => {
    const s = setup([row({ id: "r1", durationMs: 4_000, finalText: "Header fixed." })]);
    await closeSubagentsOfThePreviousProcess(s.io);
    expect(s.db.get("r1")).toMatchObject({ status: "aborted", durationMs: 4_000, finalText: "Header fixed." });
    expect(s.turns[0]!.notices[0]!.text).toBe(settlementNotice({ id: "r1", stopReason: "aborted", closingText: "", diagnostic: "stopped by a restart" }));
  });

  it("each project gets its own turn", async () => {
    const s = setup([row({ id: "r1" }), row({ id: "r2", projectId: "p2" })]);
    await closeSubagentsOfThePreviousProcess(s.io);
    expect(s.turns.map((t) => t.projectId).sort()).toEqual(["p1", "p2"]);
  });
});
