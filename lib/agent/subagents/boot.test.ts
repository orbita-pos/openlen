import { describe, expect, it } from "vitest";

import { closeSubagentsOfThePreviousProcess, type BootIO } from "./boot";
import type { SubagentRunRow } from "./store";

const NOW = Date.parse("2026-11-02T10:00:00Z");

function row(o: Partial<SubagentRunRow> & Pick<SubagentRunRow, "id">): SubagentRunRow {
  return {
    projectId: "p1", chatRowId: "row1", turnId: "t1", personId: "u1", preset: "Explore", description: "Find", prompt: "Where?",
    status: "running", transcript: null, actions: [], finalText: null, diagnostic: null, usage: null, toolUses: 0, durationMs: null,
    chargedCenticredits: 0, createdAt: new Date(NOW - 60_000), settledAt: null, noticeDeliveredAt: null,
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
    },
    launchNoticeTurn: (o) => void turns.push(o),
    now: () => NOW,
    startedAt: NOW - 10_000,
  };
  return { db, turns, io };
}

describe("at boot, what the previous process left", () => {
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
    const s = setup([row({ id: "r1", status: "completed", finalText: "In /menu/index.html:12.", settledAt: new Date(NOW - 5_000) })]);
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

  it("each project gets its own turn", async () => {
    const s = setup([row({ id: "r1" }), row({ id: "r2", projectId: "p2" })]);
    await closeSubagentsOfThePreviousProcess(s.io);
    expect(s.turns.map((t) => t.projectId).sort()).toEqual(["p1", "p2"]);
  });
});
