// A press cut off half way (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3; final review I1): a deploy or
// a restart between accepting the card and recording what came of it leaves an action `pending` on an accepted card.
// The watcher's pass finishes it, never by applying late: a change is recorded done only if the row already has it, and
// otherwise as cut off with what the row has now; a reply goes out only if its change is done or there was none.
import { describe, expect, it, vi } from "vitest";

import type { SendInput } from "@/lib/project-email/send";

import type { EventTaskCardRow } from "../store";
import { PRESS_GRACE_MS, resumeInterrupted, type ResumeDeps } from "./resume";
import { INTERRUPTED, NOT_SENT_CHANGE, freshRecord, type CardActionRecord } from "./types";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-11-04T10:00:00Z");
const change = { kind: "data_change" as const, table: "reservas", key: { id: "r7" }, set: { mesa: "6" }, before: { mesa: "4" } };
const reply = { kind: "reply" as const, channel: "email" as const, to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis." };
const project = { kind: "project" as const, text: "Preparar la pantalla de reservas." };
const card = (actions: CardActionRecord[], over: Partial<EventTaskCardRow> = {}) =>
  ({ id: "c1", taskId: "t1", projectId: "p1", status: "accepted", decidedBy: "u1", decidedAt: new Date(NOW.getTime() - 5 * 60_000), acceptedRowId: null, actions, ...over }) as unknown as EventTaskCardRow;

function world(cards: EventTaskCardRow[], row: Record<string, unknown> | null = { id: "r7", mesa: 4 }) {
  const records: [string, number, Record<string, unknown>][] = [];
  const d: ResumeDeps = {
    interrupted: vi.fn(async () => cards),
    readRow: vi.fn(async () => row),
    fromOf: async () => "noreply@notify.lamesa.mx",
    record: vi.fn(async (cardId: string, index: number, patch: Record<string, unknown>) => void records.push([cardId, index, patch])),
    send: vi.fn(async (_i: SendInput) => ({ kind: "sent" as const, id: "re_1", skipped: [] })),
    log: vi.fn(async () => {}),
  };
  return { d, records };
}

describe("resumeInterrupted", () => {
  it("asks only for cards accepted more than the grace before now, so a press still under way is left alone", async () => {
    const w = world([]);
    await resumeInterrupted(NOW, w.d);
    expect(w.d.interrupted).toHaveBeenCalledWith(new Date(NOW.getTime() - PRESS_GRACE_MS));
  });

  it("a change the cut-off press never applied is not applied late: it says so with what the row has now, and its reply isn't sent", async () => {
    const w = world([card([freshRecord(change), freshRecord(reply)])]);
    await resumeInterrupted(NOW, w.d);
    expect(w.records).toEqual([
      ["c1", 0, { state: "failed", error: INTERRUPTED, result: "mesa 4" }],
      ["c1", 1, { state: "failed", error: NOT_SENT_CHANGE }],
    ]);
    expect(w.d.send).not.toHaveBeenCalled();
  });

  it("a change the cut-off press did apply is recorded done, in Registros too, and then its reply goes out", async () => {
    const c = card([freshRecord(change), freshRecord(reply)]);
    const w = world([c], { id: "r7", mesa: 6 });
    await resumeInterrupted(NOW, w.d);
    expect(w.records[0]).toEqual(["c1", 0, { state: "done", result: "mesa 4 → 6", error: null }]);
    expect(w.d.log).toHaveBeenCalledWith(c, "applied", "mesa 4 → 6");
    expect(w.d.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "event-card:c1:reply" }));
    expect(w.records.at(-1)).toEqual(["c1", 1, expect.objectContaining({ state: "done", result: "luis@ejemplo.com" })]);
  });

  it("a reply alone that the cut-off press never sent goes out on the pass", async () => {
    const w = world([card([freshRecord(reply)])]);
    await resumeInterrupted(NOW, w.d);
    expect(w.d.send).toHaveBeenCalledTimes(1);
    expect(w.records.at(-1)).toEqual(["c1", 0, expect.objectContaining({ state: "done" })]);
  });

  it("a project action is done if its turn started, and cut off if it didn't", async () => {
    const started = world([card([freshRecord(project)], { acceptedRowId: "row-1" })]);
    await resumeInterrupted(NOW, started.d);
    expect(started.records).toEqual([["c1", 0, { state: "done", result: "row-1", error: null }]]);
    const never = world([card([freshRecord(project)])]);
    await resumeInterrupted(NOW, never.d);
    expect(never.records).toEqual([["c1", 0, { state: "failed", error: INTERRUPTED }]]);
  });
});
