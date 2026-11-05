// @vitest-environment node
//
// ACTING ON A «CREAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's action-cards — the
// card is the person's, it is reconciled with what really exists before every action, concurrent presses coalesce,
// and a decided card only settles.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolCardRow } from "./store";

vi.mock("server-only", () => ({}));

const { actOnCard } = await import("./actions");

const START = new Date("2026-11-04T12:00:00Z");
const BEFORE = new Date("2026-11-04T11:00:00Z");
const AFTER = new Date("2026-11-04T12:05:00Z");

const base: ToolCardRow = {
  id: "card-1",
  projectId: "p1",
  chatRowId: "row-1",
  personId: "u1",
  title: "Reservas de hoy",
  brief: "Ver las reservas del día.",
  initialContent: null,
  placement: "rail",
  customLocation: null,
  phase: "proposed",
  toolProjectId: null,
  hostRowId: null,
  creatorRunId: null,
  cancelRequested: false,
  installationId: null,
  error: null,
  review: null,
  createdAt: AFTER,
  updatedAt: AFTER,
  statusDeliveredAt: null,
};

let card: ToolCardRow;
let installation: { id: string; removedAt: Date | null } | null;

function deps() {
  return {
    cardById: vi.fn(async () => card),
    casPhase: vi.fn(async (_id: string, from: readonly string[], to: string, set: Partial<ToolCardRow> = {}) => {
      if (!from.includes(card.phase)) return null;
      card = { ...card, ...set, phase: to as ToolCardRow["phase"], updatedAt: AFTER };
      return card;
    }),
    installationOf: vi.fn(async () => installation as never),
    plan: vi.fn(async (): Promise<"free" | "pro"> => "pro"),
    startCreation: vi.fn(async (): Promise<{ ok: true } | { ok: false; reason: "plan_required" }> => ({ ok: true })),
    installAndCheck: vi.fn(async (c: ToolCardRow) => {
      card = { ...c, phase: "installed", installationId: "inst-1" };
    }),
    stopRun: vi.fn((_id: string) => {
      // The creator stops; its settlement records `cancelled`.
      if (card.phase === "creating") card = { ...card, phase: "cancelled" };
      return true;
    }),
    markRemoved: vi.fn(async () => true),
    restore: vi.fn(async (): Promise<"restored" | "not_found" | "release_gone"> => "restored"),
    processStartedAt: START,
    sleep: async () => {},
  };
}

const ctx = { locale: "es", timeZone: "Europe/Madrid" };
const act = (verb: Parameters<typeof actOnCard>[2], payload: Record<string, unknown> = {}, d = deps(), person = "u1") =>
  actOnCard("card-1", person, verb, { ...ctx, ...payload }, d);

beforeEach(() => {
  card = { ...base };
  installation = null;
});

describe("actOnCard — whose card", () => {
  it("someone else's card: refused unknown, nothing touched", async () => {
    const d = deps();
    expect(await act("create", {}, d, "u2")).toEqual({ status: "refused", reason: "unknown" });
    expect(d.casPhase).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("a proposed card: the place recorded, creating, the creation started", async () => {
    const d = deps();
    expect(await act("create", { placement: "project" }, d)).toEqual({ status: "accepted" });
    expect(card).toMatchObject({ phase: "creating", placement: "project", customLocation: null });
    expect(d.startCreation).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1", placement: "project" }), { personId: "u1", locale: "es", timeZone: "Europe/Madrid" });
  });

  it("a custom place of 1–1,000 characters is kept; an empty or longer one is refused", async () => {
    expect(await act("create", { customLocation: "   " })).toEqual({ status: "refused", reason: "invalid_location" });
    expect(await act("create", { customLocation: "x".repeat(1001) })).toEqual({ status: "refused", reason: "invalid_location" });
    expect(await act("create", { placement: "sidebar" })).toEqual({ status: "refused", reason: "invalid_location" });
    expect(card.phase).toBe("proposed");
    expect(await act("create", { customLocation: "  Al lado del chat  " })).toEqual({ status: "accepted" });
    expect(card.customLocation).toBe("Al lado del chat");
  });

  it("Free plan: refused plan_required and the card stays proposed", async () => {
    const d = deps();
    d.plan.mockResolvedValueOnce("free");
    expect(await act("create", { placement: "rail" }, d)).toEqual({ status: "refused", reason: "plan_required" });
    expect(card.phase).toBe("proposed");
    expect(d.startCreation).not.toHaveBeenCalled();
  });

  it("the plan dropped meanwhile (startCreation says plan_required): the card goes back to proposed", async () => {
    const d = deps();
    d.startCreation.mockResolvedValueOnce({ ok: false, reason: "plan_required" });
    expect(await act("create", { placement: "rail" }, d)).toEqual({ status: "refused", reason: "plan_required" });
    expect(card.phase).toBe("proposed");
  });

  it("🔴 two presses at once: one creation", async () => {
    const d = deps();
    const [a, b] = await Promise.all([act("create", { placement: "rail" }, d), act("create", { placement: "rail" }, d)]);
    expect(a).toEqual({ status: "accepted" });
    expect(b).toEqual({ status: "accepted" });
    expect(d.startCreation).toHaveBeenCalledTimes(1);
  });

  it("🔴 a press after another tab decided: the decided card", async () => {
    card = { ...card, phase: "dismissed" };
    const r = await act("create", { placement: "rail" });
    expect(r).toMatchObject({ status: "settled", card: { phase: "dismissed" } });
  });

  it("a replaced card only settles", async () => {
    card = { ...card, phase: "replaced" };
    expect(await act("create", { placement: "rail" })).toMatchObject({ status: "settled", card: { phase: "replaced" } });
    expect(await act("dismiss")).toMatchObject({ status: "settled", card: { phase: "replaced" } });
  });
});

describe("dismiss", () => {
  it("an open card: dismissed, with the place it had chosen", async () => {
    expect(await act("dismiss", { placement: "project" })).toMatchObject({ status: "settled", card: { phase: "dismissed", placement: "project" } });
    card = { ...base, phase: "failed" };
    expect(await act("dismiss")).toMatchObject({ status: "settled", card: { phase: "dismissed" } });
  });

  it("a decided card: settled as it is", async () => {
    card = { ...base, phase: "installed", toolProjectId: "tool-1" };
    installation = { id: "inst-1", removedAt: null };
    expect(await act("dismiss")).toMatchObject({ status: "settled", card: { phase: "installed" } });
  });
});

describe("reconcile first (🔴 a restart in the middle of «creando»)", () => {
  it("creating, written before this process started, no installation: interrupted, and «Reintentar» works", async () => {
    card = { ...base, phase: "creating", toolProjectId: "tool-1", creatorRunId: "run-1", updatedAt: BEFORE };
    expect(await act("cancel")).toMatchObject({ status: "settled", card: { phase: "interrupted" } });
    const d = deps();
    expect(await act("retry", {}, d)).toEqual({ status: "accepted" });
    expect(d.startCreation).toHaveBeenCalledTimes(1);
  });

  it("creating or installing from before the restart, but the tool did get installed: installed", async () => {
    card = { ...base, phase: "installing", toolProjectId: "tool-1", updatedAt: BEFORE };
    installation = { id: "inst-7", removedAt: null };
    expect(await act("dismiss")).toMatchObject({ status: "settled", card: { phase: "installed", installationId: "inst-7" } });
  });

  it("creating in this process is left alone (its creator settles it)", async () => {
    card = { ...base, phase: "installing", toolProjectId: "tool-1", updatedAt: AFTER };
    installation = { id: "inst-7", removedAt: null };
    expect(await act("cancel")).toMatchObject({ status: "settled", card: { phase: "installing" } });
  });

  it("installed, but removed from the Tools page: removed", async () => {
    card = { ...base, phase: "installed", toolProjectId: "tool-1", installationId: "inst-1" };
    installation = { id: "inst-1", removedAt: new Date() };
    expect(await act("undo")).toMatchObject({ status: "settled", card: { phase: "removed" } });
  });
});

describe("cancel", () => {
  it("creating: asked to cancel, the creator stopped, its settlement waited for", async () => {
    card = { ...base, phase: "creating", toolProjectId: "tool-1", creatorRunId: "run-1" };
    const d = deps();
    expect(await act("cancel", {}, d)).toMatchObject({ status: "settled", card: { phase: "cancelled" } });
    expect(card.cancelRequested).toBe(true);
    expect(d.stopRun).toHaveBeenCalledWith("run-1");
  });

  it("creating before the creator was launched: cancelled at once (the host then launches nothing)", async () => {
    card = { ...base, phase: "creating", toolProjectId: "tool-1", creatorRunId: null };
    const d = deps();
    expect(await act("cancel", {}, d)).toMatchObject({ status: "settled", card: { phase: "cancelled" } });
    expect(d.stopRun).not.toHaveBeenCalled();
  });

  it("installing: it can't be cancelled, settled as it is", async () => {
    card = { ...base, phase: "installing", toolProjectId: "tool-1" };
    expect(await act("cancel")).toMatchObject({ status: "settled", card: { phase: "installing" } });
  });
});

describe("undo and restore", () => {
  it("installed: removed", async () => {
    card = { ...base, phase: "installed", toolProjectId: "tool-1", installationId: "inst-1" };
    installation = { id: "inst-1", removedAt: null };
    const d = deps();
    expect(await act("undo", {}, d)).toMatchObject({ status: "settled", card: { phase: "removed" } });
    expect(d.markRemoved).toHaveBeenCalledWith("inst-1", "u1");
  });

  it("removed: restored and installed again", async () => {
    card = { ...base, phase: "removed", toolProjectId: "tool-1", installationId: "inst-1" };
    installation = { id: "inst-1", removedAt: new Date() };
    const d = deps();
    expect(await act("restore", {}, d)).toMatchObject({ status: "settled", card: { phase: "installed" } });
    expect(d.restore).toHaveBeenCalledWith("inst-1", "u1");
  });

  it("removed and its version gone: refused source-missing", async () => {
    card = { ...base, phase: "removed", toolProjectId: "tool-1", installationId: "inst-1" };
    installation = { id: "inst-1", removedAt: new Date() };
    const d = deps();
    d.restore.mockResolvedValueOnce("release_gone");
    expect(await act("restore", {}, d)).toEqual({ status: "refused", reason: "source-missing" });
    expect(card.phase).toBe("removed");
  });
});

describe("retry (🔴 the creator wasn't ready / the tool didn't load)", () => {
  it("failed: creating again, reusing the tool project and passing the last error", async () => {
    card = { ...base, phase: "failed", toolProjectId: "tool-1", error: "TypeError: x is undefined" };
    const d = deps();
    expect(await act("retry", {}, d)).toEqual({ status: "accepted" });
    expect(card).toMatchObject({ phase: "creating", error: null });
    expect(d.startCreation).toHaveBeenCalledWith(expect.objectContaining({ toolProjectId: "tool-1" }), expect.objectContaining({ previousError: "TypeError: x is undefined" }));
  });

  it("cancelled or interrupted: creating again; anything else settles", async () => {
    for (const phase of ["cancelled", "interrupted"] as const) {
      card = { ...base, phase, toolProjectId: "tool-1" };
      expect(await act("retry")).toEqual({ status: "accepted" });
    }
    card = { ...base, phase: "proposed" };
    expect(await act("retry")).toMatchObject({ status: "settled", card: { phase: "proposed" } });
  });
});

describe("install_anyway (🔴 install answered 428)", () => {
  it("security findings: installed with the person's acceptance of that fingerprint", async () => {
    card = { ...base, phase: "needs_review", toolProjectId: "tool-1", review: { kind: "security_findings", fingerprint: "f1", findings: ["RLS off"] } };
    const d = deps();
    expect(await act("install_anyway", {}, d)).toMatchObject({ status: "settled", card: { phase: "installed" } });
    expect(d.installAndCheck).toHaveBeenCalledWith(expect.objectContaining({ phase: "installing" }), { locale: "es", acceptSecurityFingerprint: "f1" });
  });

  it("a destructive migration: installed with its confirmation", async () => {
    card = { ...base, phase: "needs_review", toolProjectId: "tool-1", review: { kind: "needs_confirmation", fingerprint: "f2", findings: ["drop_table: notas"] } };
    const d = deps();
    await act("install_anyway", {}, d);
    expect(d.installAndCheck).toHaveBeenCalledWith(expect.anything(), { locale: "es", confirmFingerprint: "f2" });
  });

  it("not waiting for a review: settled, nothing installed", async () => {
    card = { ...base, phase: "failed", toolProjectId: "tool-1" };
    const d = deps();
    expect(await act("install_anyway", {}, d)).toMatchObject({ status: "settled", card: { phase: "failed" } });
    expect(d.installAndCheck).not.toHaveBeenCalled();
  });
});
