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
    expect(lenRequestView({ filaId: "f", note: note({}), turn: t, liveTurnoId: "t1", now: NOW })).toEqual({ filaId: "f", status: "running", turn: t, turnoId: "t1" });
  });

  it("a finished row: done, with what Len said", () => {
    const t = turn({});
    expect(lenRequestView({ filaId: "f", note: note({ status: "done" }), turn: t, liveTurnoId: null, now: NOW })).toEqual({ filaId: "f", status: "done", turn: t });
  });

  it("a row that ended in error: failed", () => {
    const t = turn({ status: "error" });
    expect(lenRequestView({ filaId: "f", note: null, turn: t, liveTurnoId: null, now: NOW })).toMatchObject({ status: "failed", turn: t });
  });

  it("a finished row wins over a note still marked queued", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: turn({}), liveTurnoId: null, now: NOW }).status).toBe("done");
  });

  it("no row yet but the turn is alive: running", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: null, liveTurnoId: "t1", now: NOW })).toEqual({ filaId: "f", status: "running", turnoId: "t1" });
  });

  it("no row and a failed note: failed, with why", () => {
    expect(lenRequestView({ filaId: "f", note: note({ status: "failed", reason: "no_credits" }), turn: null, liveTurnoId: null, now: NOW })).toEqual({ filaId: "f", status: "failed", reason: "no_credits" });
  });

  it("🔴 a heard note still tells how it ended after reopening the app", () => {
    const heard = note({ status: "failed", reason: "no_credits", at: ago(3_600_000), heardAt: NOW.toISOString() });
    expect(lenRequestView({ filaId: "f", note: heard, turn: null, liveTurnoId: null, now: NOW })).toEqual({ filaId: "f", status: "failed", reason: "no_credits" });
  });

  it("no row and a note queued longer than an hour: lost", () => {
    expect(lenRequestView({ filaId: "f", note: note({ at: ago(LOST_AFTER_MS + 1) }), turn: null, liveTurnoId: null, now: NOW }).status).toBe("lost");
  });

  it("no row and a fresh note, or nothing known yet: queued", () => {
    expect(lenRequestView({ filaId: "f", note: note({}), turn: null, liveTurnoId: null, now: NOW })).toEqual({ filaId: "f", status: "queued" });
    expect(lenRequestView({ filaId: "f", note: null, turn: null, liveTurnoId: null, now: NOW })).toEqual({ filaId: "f", status: "queued" });
  });
});
