// @vitest-environment node
//
// THE CONFIRMED DATA CHANGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, Jesús's option B): once the
// person accepted OpenLen's dialog, one production row changes with compare-and-swap on the touched columns, as
// «Hazlo» does. Never in draft; never for a member.
import { describe, expect, it, vi } from "vitest";

import type { ToolInstallationRow } from "./store";
import type { BridgeCaller } from "./bridge/handlers";
import { applyToolDataChange, type ChangeDeps } from "./data-change";

const installed: BridgeCaller = {
  personId: "u1",
  personEmail: "ana@example.com",
  locale: "es",
  timeZone: "UTC",
  mode: "installed",
  installation: { id: "i1", personId: "u1", projectId: "tool" } as ToolInstallationRow,
};
const CHANGE = { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "confirmada" }, before: { estado: "pendiente" } };
const PROJECT = { ref: "x" } as never;

const deps = (over: Partial<ChangeDeps> = {}): ChangeDeps => ({
  access: vi.fn(async () => ({ rol: "dueno" as const, duenoId: "u1" })),
  liveProject: vi.fn(async () => PROJECT),
  updateRowIf: vi.fn(async () => ({ row: { id: 12, estado: "confirmada" } })),
  readRow: vi.fn(async () => ({ id: 12, estado: "cancelada" })),
  ...over,
});

describe("applyToolDataChange", () => {
  it("applies it with compare-and-swap on the touched columns", async () => {
    const d = deps();
    expect(await applyToolDataChange(installed, CHANGE, d)).toEqual({ status: "applied", row: { id: 12, estado: "confirmada" } });
    expect(d.updateRowIf).toHaveBeenCalledWith(PROJECT, "reservas", { id: 12 }, { estado: "pendiente" }, { estado: "confirmada" });
  });

  it("in draft mode never writes production", async () => {
    const d = deps();
    expect(await applyToolDataChange({ ...installed, mode: "draft", toolProjectId: "tool" } as BridgeCaller, CHANGE, d)).toEqual({ status: "refused", reason: "draft_no_production" });
    expect(d.updateRowIf).not.toHaveBeenCalled();
  });

  it("a member can't: owner_only", async () => {
    const d = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })) });
    expect(await applyToolDataChange(installed, CHANGE, d)).toEqual({ status: "refused", reason: "owner_only" });
    expect(d.updateRowIf).not.toHaveBeenCalled();
  });

  it("the row changed meanwhile: nothing applied, the current row comes back (Review Focus 4)", async () => {
    const d = deps({ updateRowIf: vi.fn(async () => ({ changed: true as const })) });
    expect(await applyToolDataChange(installed, CHANGE, d)).toEqual({ status: "changed", current: { id: 12, estado: "cancelada" } });
    expect(d.readRow).toHaveBeenCalledWith("p1", "reservas", "id", "12");
  });

  it("a change that can't be compared is refused", async () => {
    const d = deps();
    expect(await applyToolDataChange(installed, { ...CHANGE, set: {} }, d)).toEqual({ status: "refused", reason: "bad_change" });
    expect(await applyToolDataChange(installed, { ...CHANGE, before: {} }, d)).toEqual({ status: "refused", reason: "bad_change" });
    expect(await applyToolDataChange(installed, { ...CHANGE, key: {} }, d)).toEqual({ status: "refused", reason: "bad_change" });
    expect(d.updateRowIf).not.toHaveBeenCalled();
  });

  it("without a production base, or when the backend refuses, it is refused", async () => {
    expect(await applyToolDataChange(installed, CHANGE, deps({ liveProject: vi.fn(async () => null) }))).toEqual({ status: "refused", reason: "bad_change" });
    expect(await applyToolDataChange(installed, CHANGE, deps({ updateRowIf: vi.fn(async () => ({ error: "no column" })) }))).toEqual({ status: "refused", reason: "bad_change" });
  });
});
