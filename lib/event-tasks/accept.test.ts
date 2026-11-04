// «Hazlo» and «Ahora no» (spec local 2026-11-03-len-que-avisa, §7.7): accepting launches ONE turn in the project chat,
// as whoever pressed, running the card's proposed action verbatim — the press is the approval (Claude Code), and the
// proposal is marked as the automation's, not the owner's words (DeepSeek). No raw event text rides along.
import { describe, expect, it, vi } from "vitest";

import type { EventTaskCardRow, EventTaskRow } from "./store";
import { acceptedFraming, decideAndLaunch, type AcceptDeps } from "./accept";

const NOW = new Date("2026-11-03T20:00:00Z");
const PROBE = "SONDA-DEL-VISITANTE-7f3a";

const task: EventTaskRow = {
  id: "t1", projectId: "p1", createdBy: "u1", locale: "es", timeZone: "America/Mexico_City", title: "Reservas que chocan", prompt: "Avísame si choca.",
  source: "app_rows", params: {}, state: {}, status: "active", pausedAt: null, nextCheckAt: NOW, lastCheckedAt: null, judgeDay: null, judgesThatDay: 0,
  transcript: [{ role: "user", content: `nota: ${PROBE}` }], lastJudgedAt: null, createdAt: NOW, updatedAt: NOW,
};
const card = (over: Partial<EventTaskCardRow> = {}): EventTaskCardRow => ({
  id: "c1", taskId: "t1", projectId: "p1", recordId: "r1", title: "Choca la mesa 4", summary: `Ana escribió ${PROBE}`, proposedAction: "Escribirle a Luis para ofrecerle la mesa 6.",
  status: "accepted", decidedBy: "u2", decidedAt: NOW, acceptedRowId: null, actions: null, subjectKey: null, dismissNote: null, createdAt: NOW, ...over,
});

function setup(decision: Awaited<ReturnType<AcceptDeps["decide"]>>) {
  const launched: Parameters<AcceptDeps["launch"]>[0][] = [];
  const rows: string[] = [];
  const deps: AcceptDeps = {
    now: () => NOW,
    decide: vi.fn(async () => decision),
    getTask: async () => task,
    nameOf: async () => "Marta",
    launch: (p) => void launched.push(p),
    setAcceptedRow: async (_id, row) => void rows.push(row),
    newRowId: () => "row-1",
  };
  return { deps, launched, rows };
}

describe("acceptedFraming", () => {
  it("names who pressed and when, marks the proposal as the automation's, and carries no raw event text", () => {
    const text = acceptedFraming({ card: card(), task, actorName: "Marta", at: NOW.toISOString() });
    expect(text).toContain("Escribirle a Luis para ofrecerle la mesa 6.");
    expect(text).toContain("Marta");
    expect(text).toContain(NOW.toISOString());
    expect(text).toContain("Reservas que chocan");
    expect(text).toMatch(/proposal.*not the owner's words/i);
    expect(text).not.toContain(PROBE);
  });
});

describe("decideAndLaunch", () => {
  it("accept launches one turn in the project chat as the person who pressed, with the proposed action verbatim", async () => {
    const s = setup({ ok: true, card: card() });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "accept", actorId: "u2" }, s.deps)).toEqual({
      ok: true,
      status: "accepted",
      // What the chat needs to paint the turn running and follow it, like a turn started from a code thread.
      rowId: "row-1",
      text: "🔔 Reservas que chocan: Hazlo",
      origin: { kind: "event_task", taskId: "t1", cardId: "c1", title: "Reservas que chocan" },
    });
    expect(s.launched).toHaveLength(1);
    const p = s.launched[0]!;
    expect(p).toMatchObject({ userId: "u2", projectId: "p1", filaId: "row-1", origin: { kind: "event_task", taskId: "t1", cardId: "c1", title: "Reservas que chocan" } });
    expect(p.framing).toContain("Escribirle a Luis para ofrecerle la mesa 6.");
    expect(p.texto).toBe("🔔 Reservas que chocan: Hazlo");
  });

  it("the accepted row's id is saved on the card when its turn starts", async () => {
    const s = setup({ ok: true, card: card() });
    await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "accept", actorId: "u2" }, s.deps);
    await s.launched[0]!.onStart();
    expect(s.rows).toEqual(["row-1"]);
  });

  it("dismiss records the decision and launches nothing", async () => {
    const s = setup({ ok: true, card: card({ status: "dismissed" }) });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "dismiss", actorId: "u2" }, s.deps)).toEqual({ ok: true, status: "dismissed" });
    expect(s.launched).toEqual([]);
  });

  it("a second accept is not_pending and launches nothing", async () => {
    const s = setup({ ok: false, reason: "not_pending" });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "accept", actorId: "u2" }, s.deps)).toEqual({ ok: false, reason: "not_pending" });
    expect(s.launched).toEqual([]);
  });

  it("the decision is asked for the route's project, so another project's card is never decided (review C2)", async () => {
    const s = setup({ ok: false, reason: "not_found" });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "dismiss", actorId: "u2" }, s.deps)).toEqual({ ok: false, reason: "not_found" });
    expect(s.deps.decide).toHaveBeenCalledWith("p1", "c1", "dismiss", "u2", expect.any(Date));
    expect(s.launched).toEqual([]);
  });
});
