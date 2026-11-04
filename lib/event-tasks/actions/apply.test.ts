// Applying a card's data change (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3): the OWNER's action,
// like merging a pull request. Once, and only while the row still has the values the card showed; otherwise nothing is
// applied and the card says what the row has now.
import { describe, expect, it, vi } from "vitest";

import type { BackendProject } from "@/lib/backend/router";

import type { EventTaskCardRow } from "../store";
import { applyDataChange, type ApplyDeps } from "./apply";
import { freshRecord, type CardActionRecord } from "./types";

vi.mock("server-only", () => ({}));

const change = { kind: "data_change" as const, table: "reservas", key: { id: "r2" }, set: { mesa: "6" }, before: { mesa: "4" } };
const card = (actions: CardActionRecord[]) => ({ id: "c1", projectId: "p1", actions }) as unknown as EventTaskCardRow;

function deps(o: { update?: ApplyDeps["update"]; now?: Record<string, unknown> | null; project?: BackendProject | null } = {}) {
  const recorded: unknown[] = [];
  const d: ApplyDeps = {
    project: vi.fn(async () => (o.project === undefined ? ({ ref: "x" } as BackendProject) : o.project)),
    update: o.update ?? vi.fn(async () => ({ row: { id: "r2", mesa: 6 } })),
    readRow: vi.fn(async () => (o.now === undefined ? { id: "r2", mesa: 5 } : o.now)),
    record: vi.fn(async (_cardId, _index, rec) => void recorded.push(rec)),
  };
  return { d, recorded };
}

describe("applyDataChange", () => {
  it("applies once and records done with before and after", async () => {
    const s = deps();
    const r = await applyDataChange(card([freshRecord(change)]), 0, s.d);
    expect(r).toEqual({ state: "done", result: "mesa 4 → 6", error: null });
    expect(s.d.update).toHaveBeenCalledWith({ ref: "x" }, "reservas", { id: "r2" }, { mesa: "4" }, { mesa: "6" });
    expect(s.recorded).toEqual([{ state: "done", result: "mesa 4 → 6", error: null }]);
  });

  it("a row that changed since the card is blocked, nothing is applied, and the card says what it has now (review focus 1)", async () => {
    const s = deps({ update: vi.fn(async () => ({ changed: true as const })) });
    const r = await applyDataChange(card([freshRecord(change)]), 0, s.d);
    expect(r).toEqual({ state: "blocked", result: "mesa 5", error: "The row changed since the card was made." });
    expect(s.recorded).toEqual([r]);
  });

  it("an action already done is not applied again", async () => {
    const s = deps();
    const done = { ...freshRecord(change), state: "done" as const, result: "mesa 4 → 6" };
    expect(await applyDataChange(card([done]), 0, s.d)).toEqual({ state: "done", result: "mesa 4 → 6", error: null });
    expect(s.d.update).not.toHaveBeenCalled();
    expect(s.d.record).not.toHaveBeenCalled();
  });

  it("without a production base it fails with the reason", async () => {
    const s = deps({ project: null });
    expect(await applyDataChange(card([freshRecord(change)]), 0, s.d)).toMatchObject({ state: "failed", error: expect.stringMatching(/production/) });
    expect(s.d.update).not.toHaveBeenCalled();
  });

  it("a REST error is failed with its message, nothing applied", async () => {
    const s = deps({ update: vi.fn(async () => ({ error: "permission denied" })) });
    expect(await applyDataChange(card([freshRecord(change)]), 0, s.d)).toMatchObject({ state: "failed", error: "permission denied" });
  });
});
