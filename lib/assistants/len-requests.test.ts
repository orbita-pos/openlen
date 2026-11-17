import { describe, expect, it } from "vitest";

import type { StoredChatTurn } from "@/lib/projects/types";

import { lenRequestView } from "./len-requests";
import { LOST_AFTER_MS, type AskLenNotice } from "./notices";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const turn = (o: Partial<StoredChatTurn>): StoredChatTurn => ({ id: "f", userText: "botón verde", assistantReasoning: "Listo.", status: "applied", appliedAt: NOW.getTime(), ...o }) as StoredChatTurn;
const note = (o: Partial<AskLenNotice>): AskLenNotice => ({ id: "n", request: "botón verde", status: "queued", at: ago(60_000), filaId: "f", projectId: "p1", ...o });

describe("how a request to Len is going, for her card on the phone", () => {
  it("a row Len is working on: running, with the turn to stop it", () => {
    const t = turn({ enCurso: true });
    expect(lenRequestView({ filaId: "f", note: note({}), turn: t, liveTurnoId: "t1", rowAlive: true, now: NOW })).toEqual({ filaId: "f", status: "running", turn: t, turnoId: "t1" });
  });

  it("a finished row: done, with what Len said", () => {
    const t = turn({});
    expect(lenRequestView({ filaId: "f", note: note({ status: "done" }), turn: t, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "done", turn: t });
  });

  it("a row that ended in error: failed", () => {
    const t = turn({ status: "error" });
    expect(lenRequestView({ filaId: "f", note: null, turn: t, liveTurnoId: null, rowAlive: false, now: NOW })).toMatchObject({ status: "failed", turn: t });
  });

  // Deferred minor of the final review: a stopped turn read «Len terminó».
  it("🔴 a turn stopped with ■ (cut, or closed before changing anything): stopped, never «done»", () => {
    const cut = turn({ cortado: true, endReason: "cancelled" });
    expect(lenRequestView({ filaId: "f", note: null, turn: cut, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "stopped", turn: cut });
    const early = turn({ status: "error", endReason: "cancelled" });
    expect(lenRequestView({ filaId: "f", note: null, turn: early, liveTurnoId: null, rowAlive: false, now: NOW }).status).toBe("stopped");
  });

  it("🔴 a turn cut by a restart, or by any other reason: failed with it, never «done»", () => {
    const cut = turn({ cortado: true, endReason: "interrupted" });
    expect(lenRequestView({ filaId: "f", note: null, turn: cut, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "failed", reason: "interrupted", turn: cut });
  });

  it("a finished row wins over a note still marked queued", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: turn({}), liveTurnoId: null, rowAlive: false, now: NOW }).status).toBe("done");
  });

  it("no row yet but the turn is alive: running", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: null, liveTurnoId: "t1", rowAlive: true, now: NOW })).toEqual({ filaId: "f", status: "running", turnoId: "t1" });
  });

  it("no row and a failed note: failed, with why", () => {
    expect(lenRequestView({ filaId: "f", note: note({ status: "failed", reason: "no_credits" }), turn: null, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "failed", reason: "no_credits" });
  });

  it("🔴 a heard note still tells how it ended after reopening the app", () => {
    const heard = note({ status: "failed", reason: "no_credits", at: ago(3_600_000), heardAt: NOW.toISOString() });
    expect(lenRequestView({ filaId: "f", note: heard, turn: null, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "failed", reason: "no_credits" });
  });

  it("no row and a note queued longer than an hour: lost", () => {
    expect(lenRequestView({ filaId: "f", note: note({ at: ago(LOST_AFTER_MS + 1) }), turn: null, liveTurnoId: null, rowAlive: false, now: NOW }).status).toBe("lost");
  });

  it("no row and a fresh note: queued", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: null, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "queued" });
  });

  // Final review, I1: every request writes its note before Len's turn is launched, so with no row, no note and no live
  // turn, the note was pruned (a week after she heard it): it is over, never «in line» again — and never polled forever.
  it("🔴 nothing known any more: lost, a status that ends, never queued", () => {
    expect(lenRequestView({ filaId: "f", note: null, turn: null, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "lost" });
  });

  it("no row and a note that says done: done", () => {
    expect(lenRequestView({ filaId: "f", note: note({ status: "done" }), turn: null, liveTurnoId: null, rowAlive: false, now: NOW })).toEqual({ filaId: "f", status: "done" });
  });

  // Final review, I1: a row left «en curso» by a restart is no one's turn — it would read «running» forever.
  it("🔴 a row in progress that no turn runs: it was cut, it failed", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: turn({ enCurso: true }), liveTurnoId: null, rowAlive: false, now: NOW })).toMatchObject({ status: "failed", reason: "interrupted" });
  });

  it("a row in progress that another person's turn runs here: running, without «Parar»", () => {
    const v = lenRequestView({ filaId: "f", note: note({}), turn: turn({ enCurso: true }), liveTurnoId: null, rowAlive: true, now: NOW });
    expect(v.status).toBe("running");
    expect(v.turnoId).toBeUndefined();
  });
});
