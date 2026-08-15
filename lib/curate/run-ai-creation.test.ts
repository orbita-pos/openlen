import { describe, expect, it, vi } from "vitest";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { SectionRecord } from "@/lib/sections/store";
import { DEFAULT_PAGE_IMAGES, pageImageAllowance, runAiCreation, type RunAiCreationDeps } from "./run-ai-creation";

const BASELINE_HTML = "<!doctype html><html><body><section>baseline</section></body></html>";
const IMPROVED_HTML = "<!doctype html><html><body><section>improved</section></body></html>";
const VISUAL_ENGINE = { schemaVersion: "visual-engine-project/1.0", route: "section_composition", templateId: null } as never;

const PROFILE = { business_name: "Mundo Pincel", brand: { accent: "#f06aa6", logoUrl: null } } as BusinessProfileData;
const RECORDS = [{ id: "hero-one", type: "hero" }] as unknown as SectionRecord[];

const INPUT = {
  projectId: "11111111-1111-4111-8111-111111111111",
  brief: "Crea una página para Mundo Pincel, dibujos para colorear",
  profileData: PROFILE,
};

function runtime() {
  const events: string[] = [];
  const composition = {
    pageBudget: {} as never,
    fireworksClient: {} as never,
    fireworksToolClient: {} as never,
    glmSectionProgramProvider: {} as never,
    geminiAssetPackProvider: {} as never,
    inputAdapters: {} as never,
    recordModel: vi.fn(),
    recordImage: vi.fn(),
    recordDegraded: vi.fn((stage: string, reasonCode: string) => { events.push(`degraded:${stage}:${reasonCode}`); }),
    recordFailure: vi.fn(async (stage: string, reasonCode: string) => { events.push(`failure:${stage}:${reasonCode}`); }),
    recordDelivered: vi.fn(async () => { events.push("delivered"); }),
    runFinalGate: vi.fn(),
  };
  return { composition, events };
}

function deps(over: Partial<RunAiCreationDeps> = {}, host = runtime()): RunAiCreationDeps & { events: string[] } {
  return {
    events: host.events,
    createFableRuntimeComposition: (() => host.composition) as never,
    listSections: (async () => RECORDS) as never,
    renderViewports: (async () => ({ mobileOverflow: false, invalidGeometry: false })) as never,
    runCreativeGeneration: (async () => ({
      ok: true as const,
      route: "section_composition" as const,
      templateId: null,
      title: "Mundo Pincel",
      html: IMPROVED_HTML,
      visualEngine: VISUAL_ENGINE,
      filled: true,
      appliedOps: 6,
      degraded: false,
    })) as never,
    ...over,
  } as RunAiCreationDeps & { events: string[] };
}

describe("runAiCreation", () => {
  it("delivers the generated page through the unchanged public contract", async () => {
    const result = await runAiCreation(INPUT, deps());
    expect(result).toMatchObject({
      ok: true,
      route: "section_composition",
      templateId: null,
      title: "Mundo Pincel",
      html: IMPROVED_HTML,
      filled: true,
      appliedOps: 6,
    });
    expect(result.ok && typeof result.finalizeFableTelemetry).toBe("function");
  });

  it("delivers a degraded baseline page as an ordinary success", async () => {
    const result = await runAiCreation(INPUT, deps({
      runCreativeGeneration: (async () => ({
        ok: true, route: "section_composition", templateId: null, title: "Mundo Pincel",
        html: BASELINE_HTML, visualEngine: VISUAL_ENGINE, filled: true, appliedOps: 4, degraded: true,
      })) as never,
    }));
    expect(result).toMatchObject({ ok: true, html: BASELINE_HTML });
  });

  it("fails when the section catalog is empty, before any paid work", async () => {
    const generation = vi.fn();
    const result = await runAiCreation(INPUT, deps({
      listSections: (async () => []) as never,
      runCreativeGeneration: generation as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "sections", reasonCode: "section_inventory_unavailable" });
    expect(generation).not.toHaveBeenCalled();
  });

  it("fails when the section catalog cannot be read at all", async () => {
    const result = await runAiCreation(INPUT, deps({
      listSections: (async () => { throw new Error("db down"); }) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "sections", reasonCode: "section_inventory_unavailable" });
  });

  it("fails when the runtime cannot be composed", async () => {
    const result = await runAiCreation(INPUT, deps({
      createFableRuntimeComposition: (() => { throw new Error("no budget"); }) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition", reasonCode: "composition_failed" });
  });

  it.each([
    ["section_inventory_unavailable", "section_inventory_unavailable"],
    ["baseline_invalid", "composition_failed"],
  ])("maps the baseline failure %s onto the public reason %s", async (code, reasonCode) => {
    const result = await runAiCreation(INPUT, deps({
      runCreativeGeneration: (async () => ({ ok: false, stage: "composition", reasonCode: code })) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition", reasonCode });
  });

  it.each([
    ["asset_metadata_invalid", "asset_resolution_failed"],
    ["invalid_composition_metadata", "semantic_gate_failed"],
  ])("maps the delivery failure %s onto the public reason %s", async (code, reasonCode) => {
    const result = await runAiCreation(INPUT, deps({
      runCreativeGeneration: (async () => ({ ok: false, stage: "delivery_gate", reasonCode: code })) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "delivery_gate", reasonCode });
  });

  it("records a redacted failure through the runtime telemetry", async () => {
    const host = runtime();
    const result = await runAiCreation(INPUT, deps({
      runCreativeGeneration: (async () => ({ ok: false, stage: "composition", reasonCode: "baseline_invalid" })) as never,
    }, host));
    expect(result.ok).toBe(false);
    expect(host.events).toContain("failure:initial_program:composition_failed");
    expect(JSON.stringify(host.events)).not.toContain("<!doctype");
  });

  it("passes the loaded catalog and brief straight into generation", async () => {
    const generation = vi.fn(async (_input: { projectId: string; brief: string; records: unknown }) => ({
      ok: true as const, route: "section_composition" as const, templateId: null, title: "T",
      html: IMPROVED_HTML, visualEngine: VISUAL_ENGINE, filled: true, appliedOps: 1, degraded: false,
    }));
    await runAiCreation(INPUT, deps({ runCreativeGeneration: generation as never }));
    expect(generation.mock.calls[0][0]).toMatchObject({
      projectId: INPUT.projectId,
      brief: INPUT.brief,
      records: RECORDS,
    });
  });

  it("wires production boundaries when no generation override is supplied", async () => {
    const buildBaseline = vi.fn(async () => ({ ok: false as const, code: "baseline_invalid" as const }));
    const result = await runAiCreation(INPUT, deps({
      runCreativeGeneration: undefined,
      creativeGenerationDeps: { buildBaseline } as never,
    }));
    expect(buildBaseline).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, stage: "composition", reasonCode: "composition_failed" });
  });

  it("reports progress without letting a throwing callback change delivery", async () => {
    const result = await runAiCreation({ ...INPUT, onStage: () => { throw new Error("ui blew up"); } }, deps());
    expect(result.ok).toBe(true);
  });
});

describe("pageImageAllowance", () => {
  const intent = (requestedImages?: number | null) =>
    ({ ...(requestedImages === undefined ? {} : { requestedImages }) } as never);

  it("gives two when the brief says nothing about imagery", () => {
    expect(pageImageAllowance(intent(), 50)).toBe(DEFAULT_PAGE_IMAGES);
    expect(pageImageAllowance(intent(null), 50)).toBe(DEFAULT_PAGE_IMAGES);
  });

  it("gives what the brief asked for, because that choice is the user's", () => {
    expect(pageImageAllowance(intent(4), 50)).toBe(4);
    expect(pageImageAllowance(intent(0), 50)).toBe(0);
  });

  it("never spends more than the balance can pay", () => {
    // One credit for the page, one per image. A brief demanding fifty
    // photographs must not empty a month's allowance.
    expect(pageImageAllowance(intent(50), 6)).toBe(5);
    expect(pageImageAllowance(intent(4), 1)).toBe(0);
    expect(pageImageAllowance(intent(4), 0)).toBe(0);
  });
});
