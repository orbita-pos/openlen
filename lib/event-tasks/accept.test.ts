// «Hazlo» and «Ahora no» (spec local 2026-11-03-len-que-avisa, §7.7): accepting launches ONE turn in the project chat,
// as whoever pressed, running the card's proposed action verbatim — the press is the approval (Claude Code), and the
// proposal is marked as the automation's, not the owner's words (DeepSeek). No raw event text rides along.
import { describe, expect, it, vi } from "vitest";

import { freshRecord, type CardAction, type CardActionRecord } from "./actions/types";
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
  status: "accepted", decidedBy: "u2", decidedAt: NOW, acceptedRowId: null, actions: null, subjectKey: null, dismissNote: null, lookedAgain: null, createdAt: NOW, ...over,
});

const change: CardAction = { kind: "data_change", table: "reservas", key: { id: "r7" }, set: { mesa: "6" }, before: { mesa: "4" } };
const reply: CardAction = { kind: "reply", channel: "email", to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis, te movimos a la mesa 6." };
const project: CardAction = { kind: "project", text: "Prepararle al dueño la pantalla de reservas por mesa." };
const withActions = (records: CardActionRecord[], over: Partial<EventTaskCardRow> = {}) => card({ actions: records, ...over });

function setup(decision: Awaited<ReturnType<AcceptDeps["decide"]>>, o: { found?: EventTaskCardRow | null } = {}) {
  const launched: Parameters<AcceptDeps["launch"]>[0][] = [];
  const rows: string[] = [];
  const order: string[] = [];
  const deps: AcceptDeps = {
    now: () => NOW,
    decide: vi.fn(async () => decision),
    getTask: async () => task,
    getCard: vi.fn(async () => (o.found === undefined ? card() : o.found)),
    nameOf: async () => "Marta",
    launch: (p) => void launched.push(p),
    setAcceptedRow: async (_id, row) => void rows.push(row),
    newRowId: () => "row-1",
    apply: vi.fn(async () => {
      order.push("apply");
      return { state: "done" as const, result: "mesa 4 → 6", error: null };
    }),
    send: vi.fn(async () => {
      order.push("send");
      return { state: "done" as const, error: null };
    }),
    record: vi.fn(async () => {}),
    requeue: vi.fn(async () => ({ ok: true as const })),
    withdraw: vi.fn(async () => {}),
  };
  return { deps, launched, rows, order };
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
      results: [],
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
    expect(s.deps.decide).toHaveBeenCalledWith("p1", "c1", "dismiss", "u2", expect.any(Date), null);
    expect(s.launched).toEqual([]);
  });
});

describe("«Hazlo» does what the card shows (spec local 2026-11-04-hazlo, §7.3)", () => {
  const accept = { projectId: "p1", cardId: "c1", action: "accept" as const, actorId: "u2" };

  it("accept on a card with a data_change and a reply applies, then sends, and answers both results", async () => {
    const s = setup({ ok: true, card: withActions([freshRecord(change), freshRecord(reply)]) });
    expect(await decideAndLaunch(accept, s.deps)).toEqual({
      ok: true,
      status: "accepted",
      results: [
        { kind: "data_change", state: "done", error: null },
        { kind: "reply", state: "done", error: null },
      ],
    });
    expect(s.order).toEqual(["apply", "send"]);
    expect(s.deps.apply).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), 0);
    expect(s.deps.send).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), 1);
    // Neither is Len's: no turn runs for them.
    expect(s.launched).toEqual([]);
  });

  it("a blocked data_change sends nothing", async () => {
    const s = setup({ ok: true, card: withActions([freshRecord(change), freshRecord(reply)]) });
    vi.mocked(s.deps.apply).mockResolvedValueOnce({ state: "blocked", result: "mesa 5", error: "The row changed since the card was made." });
    expect(await decideAndLaunch(accept, s.deps)).toMatchObject({
      results: [
        { kind: "data_change", state: "blocked", error: "The row changed since the card was made." },
        { kind: "reply", state: "pending", error: null },
      ],
    });
    expect(s.deps.send).not.toHaveBeenCalled();
  });

  it("a reply alone goes out without any row to compare", async () => {
    const s = setup({ ok: true, card: withActions([freshRecord(reply)]) });
    expect(await decideAndLaunch(accept, s.deps)).toMatchObject({ results: [{ kind: "reply", state: "done", error: null }] });
    expect(s.deps.apply).not.toHaveBeenCalled();
  });

  it("a project-only card still launches the framed turn, framed with that action's text", async () => {
    const s = setup({ ok: true, card: withActions([freshRecord(project)], { proposedAction: "otra cosa" }) });
    expect(await decideAndLaunch(accept, s.deps)).toMatchObject({ status: "accepted", results: [{ kind: "project", state: "done", error: null }], rowId: "row-1" });
    expect(s.launched).toHaveLength(1);
    expect(s.launched[0]!.framing).toContain(project.text);
    expect(s.launched[0]!.framing).not.toContain("otra cosa");
    expect(s.deps.record).toHaveBeenCalledWith("c1", 0, { state: "done", result: "row-1", error: null });
  });

  it("dismiss with a note keeps it on the card and requeues the record with the note", async () => {
    const s = setup({ ok: true, card: card({ status: "dismissed" }) });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "dismiss", actorId: "u2", note: "Ofrécele la 8, la 6 es de fumadores." }, s.deps)).toEqual({ ok: true, status: "dismissed", lookingAgain: true });
    expect(s.deps.decide).toHaveBeenCalledWith("p1", "c1", "dismiss", "u2", NOW, "Ofrécele la 8, la 6 es de fumadores.");
    // The task's day, in its zone: 14:00 in Mexico City.
    expect(s.deps.requeue).toHaveBeenCalledWith("r1", "Ofrécele la 8, la 6 es de fumadores.", "2026-11-03", NOW);
  });

  it("look_again requeues a blocked card's record", async () => {
    const blocked = { ...freshRecord(change), state: "blocked" as const, error: "The row changed since the card was made." };
    const s = setup({ ok: false, reason: "not_pending" }, { found: withActions([blocked, freshRecord(reply)]) });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "look_again", actorId: "u2" }, s.deps)).toEqual({ ok: true, status: "looking_again" });
    expect(s.deps.requeue).toHaveBeenCalledWith("r1", null, "2026-11-03", NOW);
    expect(s.deps.decide).not.toHaveBeenCalled();
  });

  it("look_again on a card with nothing blocked is refused, and requeues nothing", async () => {
    const s = setup({ ok: false, reason: "not_pending" }, { found: withActions([freshRecord(change)]) });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "look_again", actorId: "u2" }, s.deps)).toEqual({ ok: false, reason: "not_blocked" });
    expect(s.deps.requeue).not.toHaveBeenCalled();
  });

  it("a re-judge past the day's 24 is refused with daily_limit and requeues nothing", async () => {
    const blocked = { ...freshRecord(change), state: "blocked" as const };
    const s = setup({ ok: false, reason: "not_pending" }, { found: withActions([blocked]) });
    vi.mocked(s.deps.requeue).mockResolvedValueOnce({ ok: false, reason: "daily_limit" });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "look_again", actorId: "u2" }, s.deps)).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("withdraw_send stops a reply still being sent; any other action is not_sending", async () => {
    const sending = { ...freshRecord(reply), state: "sending" as const, attempts: 3, error: "Resend is down" };
    const s = setup({ ok: false, reason: "not_pending" }, { found: withActions([freshRecord(change), sending]) });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "withdraw_send", actorId: "u2", index: 1 }, s.deps)).toEqual({ ok: true, status: "withdrawn" });
    expect(s.deps.withdraw).toHaveBeenCalledWith("c1", 1);
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "withdraw_send", actorId: "u2", index: 0 }, s.deps)).toEqual({ ok: false, reason: "not_sending" });
    expect(s.deps.withdraw).toHaveBeenCalledTimes(1);
  });

  it("look_again and withdraw_send on another project's card are not_found (review C2)", async () => {
    const blocked = { ...freshRecord(change), state: "blocked" as const };
    const s = setup({ ok: false, reason: "not_pending" }, { found: withActions([blocked], { projectId: "p2" }) });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "look_again", actorId: "u2" }, s.deps)).toEqual({ ok: false, reason: "not_found" });
    expect(await decideAndLaunch({ projectId: "p1", cardId: "c1", action: "withdraw_send", actorId: "u2", index: 0 }, s.deps)).toEqual({ ok: false, reason: "not_found" });
    expect(s.deps.requeue).not.toHaveBeenCalled();
    expect(s.deps.withdraw).not.toHaveBeenCalled();
  });
});
