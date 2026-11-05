// @vitest-environment node
//
// «CREAR» STARTS THE CREATOR AND INSTALLS WHAT IT HANDS BACK (spec local 2026-11-04-herramientas-hechas-por-len, §4.10):
// the person's tool project is born, a host turn launches the `creator` child, and its result — not Len — decides the
// card: ready → install through the gates and load-test it; not ready, stopped or failed → the card says so.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolCardRow } from "./store";

vi.mock("server-only", () => ({}));

const { onCreatorSettled, startCreation, creationCapCentis, installAndCheck, hostTheCreator, READY_SCHEMA } = await import("./creation");

const baseCard: ToolCardRow = {
  id: "card-1",
  projectId: "p1",
  chatRowId: "row-1",
  personId: "u1",
  title: "Reservas de hoy",
  brief: "Ver las reservas del día.",
  initialContent: null,
  placement: "rail",
  customLocation: null,
  phase: "creating",
  toolProjectId: null,
  hostRowId: null,
  creatorRunId: null,
  cancelRequested: false,
  installationId: null,
  error: null,
  review: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  statusDeliveredAt: null,
};

let card: ToolCardRow;
const installation = { id: "inst-1", projectId: "tool-1", releaseSha: "sha", personId: "u1" };

function deps() {
  return {
    createProject: vi.fn(async () => "tool-1"),
    bornAsTool: vi.fn(async (): Promise<"born" | "not_blank" | "plan_required"> => "born"),
    cardById: vi.fn(async () => card),
    casPhase: vi.fn(async (_id: string, from: readonly string[], to: string, set: Partial<ToolCardRow> = {}) => {
      if (!from.includes(card.phase)) return null;
      card = { ...card, ...set, phase: to as ToolCardRow["phase"] };
      return card;
    }),
    launchHost: vi.fn(),
    installTool: vi.fn(async (): Promise<{ status: number; body: Record<string, unknown> }> => ({ status: 200, body: { installation } })),
    loadTest: vi.fn(async (): Promise<{ ok: true } | { ok: false; errors: string[] }> => ({ ok: true })),
    markRemoved: vi.fn(async () => true),
    stopRun: vi.fn((_id: string) => true),
    newId: () => "host-row-1",
    capCentis: 2500,
  };
}

beforeEach(() => {
  card = { ...baseCard };
});

describe("startCreation", () => {
  it("the person's tool project is born and the host is launched once, with the cap and the Creator's task", async () => {
    const d = deps();
    expect(await startCreation(card, { personId: "u1", locale: "es", timeZone: "UTC" }, d)).toEqual({ ok: true });
    expect(d.createProject).toHaveBeenCalledWith("u1", { title: "Reservas de hoy", brief: "Ver las reservas del día.", html: "" });
    expect(d.bornAsTool).toHaveBeenCalledWith({ projectId: "tool-1", userId: "u1", title: "Reservas de hoy", locale: "es" });
    expect(card).toMatchObject({ toolProjectId: "tool-1", hostRowId: "host-row-1", phase: "creating" });
    expect(d.launchHost).toHaveBeenCalledTimes(1);
    const host = d.launchHost.mock.calls[0]![0] as Record<string, unknown>;
    expect(host).toMatchObject({ userId: "u1", projectId: "tool-1", filaId: "host-row-1", ceilingCentis: 2500, origin: { kind: "tool_creation", cardId: "card-1", title: "Reservas de hoy" } });
    expect(String(host.framing)).toContain("Ver las reservas del día.");
  });

  it("a retry reuses the tool project and passes the last error", async () => {
    card = { ...card, toolProjectId: "tool-1", error: "TypeError: boom" };
    const d = deps();
    await startCreation(card, { personId: "u1", locale: "es", timeZone: "UTC", previousError: "TypeError: boom" }, d);
    expect(d.createProject).not.toHaveBeenCalled();
    expect(String((d.launchHost.mock.calls[0]![0] as { framing: string }).framing)).toContain("TypeError: boom");
  });

  it("Free plan: nothing launched, plan_required", async () => {
    const d = deps();
    d.bornAsTool.mockResolvedValueOnce("plan_required");
    expect(await startCreation(card, { personId: "u1", locale: "es", timeZone: "UTC" }, d)).toEqual({ ok: false, reason: "plan_required" });
    expect(d.launchHost).not.toHaveBeenCalled();
  });

  it("the host failing to start marks the card failed with its reason", async () => {
    const d = deps();
    await startCreation(card, { personId: "u1", locale: "es", timeZone: "UTC" }, d);
    await (d.launchHost.mock.calls[0]![0] as { fail: (r: string | null) => Promise<void> }).fail("no_credits");
    expect(card).toMatchObject({ phase: "failed", error: "no_credits" });
  });

  it("the cap is OPENLEN_TOOL_CREATION_CAP credits, 25 by default", () => {
    expect(creationCapCentis({})).toBe(2500);
    expect(creationCapCentis({ OPENLEN_TOOL_CREATION_CAP: "10" })).toBe(1000);
    expect(creationCapCentis({ OPENLEN_TOOL_CREATION_CAP: "nope" })).toBe(2500);
  });
});

describe("onCreatorSettled", () => {
  const settle = (r: Partial<{ status: string; structured: Record<string, unknown> | null; finalText: string }>, d = deps()) =>
    onCreatorSettled("card-1", { id: "run-1", status: "completed", structured: { ready: true }, finalText: "", ...r } as never, { locale: "es" }, d).then(() => d);

  beforeEach(() => {
    card = { ...card, toolProjectId: "tool-1" };
  });

  it("ready: installed through the gates, waiting for a review still running, then load-tested", async () => {
    const d = await settle({});
    expect(d.installTool).toHaveBeenCalledWith({ projectId: "tool-1", actorId: "u1", locale: "es", requestHost: null, waitWhenPending: true });
    expect(d.loadTest).toHaveBeenCalledWith(installation, "u1", "es");
    expect(card).toMatchObject({ phase: "installed", installationId: "inst-1" });
  });

  it("not ready: no install, failed with its one sentence", async () => {
    const d = await settle({ structured: { ready: false }, finalText: "Falta saber a qué hora abre el café." });
    expect(d.installTool).not.toHaveBeenCalled();
    expect(card).toMatchObject({ phase: "failed", error: "Falta saber a qué hora abre el café." });
  });

  it("stopped after the card asked to cancel: cancelled; stopped otherwise: interrupted; an error: failed", async () => {
    card = { ...card, cancelRequested: true };
    await settle({ status: "aborted", structured: null });
    expect(card.phase).toBe("cancelled");
    card = { ...card, phase: "creating", cancelRequested: false };
    await settle({ status: "aborted", structured: null });
    expect(card.phase).toBe("interrupted");
    card = { ...card, phase: "creating" };
    await settle({ status: "error", structured: null, finalText: "" });
    expect(card).toMatchObject({ phase: "failed", error: "error" });
  });

  it("a card no longer creating is left alone", async () => {
    card = { ...card, phase: "cancelled" };
    const d = await settle({});
    expect(d.installTool).not.toHaveBeenCalled();
    expect(card.phase).toBe("cancelled");
  });

  it("install answers 428 with findings: needs your review, with them", async () => {
    const d = deps();
    d.installTool.mockResolvedValueOnce({ status: 428, body: { error: "security_findings", fingerprint: "f1", blocking: [{ description: "RLS off on notas", category: "rls" }] } });
    await settle({}, d);
    expect(card).toMatchObject({ phase: "needs_review", review: { kind: "security_findings", fingerprint: "f1", findings: ["RLS off on notas"] } });
  });

  it("a destructive migration: needs your review, with its confirmation", async () => {
    const d = deps();
    d.installTool.mockResolvedValueOnce({ status: 428, body: { error: "confirmation_required", fingerprint: "f2", destructive: [{ kind: "drop_table", table: "notas" }] } });
    await settle({}, d);
    expect(card).toMatchObject({ phase: "needs_review", review: { kind: "needs_confirmation", fingerprint: "f2" } });
    expect(card.review?.findings[0]).toContain("notas");
  });

  it("installed but it doesn't load: removed again, failed with the JS error", async () => {
    const d = deps();
    d.loadTest.mockResolvedValueOnce({ ok: false, errors: ["TypeError: x is undefined"] });
    await settle({}, d);
    expect(d.markRemoved).toHaveBeenCalledWith("inst-1", "u1");
    expect(card).toMatchObject({ phase: "failed", error: "TypeError: x is undefined" });
  });

  it("another install error: failed with it", async () => {
    const d = deps();
    d.installTool.mockResolvedValueOnce({ status: 422, body: { error: "app_does_not_compile", errors: ["/src/App.tsx:3:1 — boom"] } });
    await settle({}, d);
    expect(card).toMatchObject({ phase: "failed", error: "app_does_not_compile: /src/App.tsx:3:1 — boom" });
  });
});

describe("installAndCheck with the person's acceptance («Instalar igual»)", () => {
  it("passes the fingerprints through", async () => {
    card = { ...card, phase: "installing", toolProjectId: "tool-1" };
    const d = deps();
    await installAndCheck(card, { locale: "es", acceptSecurityFingerprint: "f1" }, d);
    expect(d.installTool).toHaveBeenCalledWith(expect.objectContaining({ acceptSecurityFingerprint: "f1" }));
    expect(card.phase).toBe("installed");
  });
});

describe("hostTheCreator (the host turn, no model call)", () => {
  const launcher = () => ({ launch: vi.fn(async (_o: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string }> => ({ ok: true, id: "run-9" })) });

  beforeEach(() => {
    card = { ...card, toolProjectId: "tool-1", hostRowId: "host-row-1" };
  });

  it("launches the creator with DeepSeek's activation options and keeps its run id on the card", async () => {
    const d = deps();
    const l = launcher();
    const text = await hostTheCreator({ cardId: "card-1", framing: '{"task":"x"}', locale: "es", launcher: l }, d);
    const o = l.launch.mock.calls[0]![0];
    expect(o).toMatchObject({ preset: "creator", description: "Reservas de hoy", prompt: '{"task":"x"}', delivery: "caller", outputSchema: READY_SCHEMA });
    expect(typeof o.onSettled).toBe("function");
    expect(card.creatorRunId).toBe("run-9");
    expect(text).toContain("Reservas de hoy");
  });

  it("its onSettled is the card's: ready installs", async () => {
    const d = deps();
    const l = launcher();
    await hostTheCreator({ cardId: "card-1", framing: "{}", locale: "es", launcher: l }, d);
    await (l.launch.mock.calls[0]![0].onSettled as (r: unknown) => Promise<void>)({ id: "run-9", status: "completed", structured: { ready: true }, finalText: "" });
    expect(card.phase).toBe("installed");
  });

  it("subagents off: nothing launched, the card failed", async () => {
    const d = deps();
    await hostTheCreator({ cardId: "card-1", framing: "{}", locale: "es", launcher: undefined }, d);
    expect(card).toMatchObject({ phase: "failed", error: "subagents_off" });
  });

  it("the launch refused: the card failed with its code", async () => {
    const d = deps();
    const l = launcher();
    l.launch.mockResolvedValueOnce({ ok: false, code: "budget", message: "no budget" });
    await hostTheCreator({ cardId: "card-1", framing: "{}", locale: "es", launcher: l }, d);
    expect(card).toMatchObject({ phase: "failed", error: "budget" });
  });

  it("🔴 «Cancelar» pressed while the creator was being launched: it is stopped", async () => {
    const d = deps();
    const l = launcher();
    l.launch.mockImplementationOnce(async () => {
      card = { ...card, phase: "cancelled", cancelRequested: true };
      return { ok: true, id: "run-9" };
    });
    await hostTheCreator({ cardId: "card-1", framing: "{}", locale: "es", launcher: l }, d);
    expect(d.stopRun).toHaveBeenCalledWith("run-9");
  });

  it("asked to cancel (still creating) while being launched: stopped too", async () => {
    const d = deps();
    const l = launcher();
    l.launch.mockImplementationOnce(async () => {
      card = { ...card, cancelRequested: true };
      return { ok: true, id: "run-9" };
    });
    await hostTheCreator({ cardId: "card-1", framing: "{}", locale: "es", launcher: l }, d);
    expect(d.stopRun).toHaveBeenCalledWith("run-9");
  });

  it("a card cancelled before the host started: nothing launched", async () => {
    card = { ...card, phase: "cancelled" };
    const d = deps();
    const l = launcher();
    await hostTheCreator({ cardId: "card-1", framing: "{}", locale: "es", launcher: l }, d);
    expect(l.launch).not.toHaveBeenCalled();
  });
});
