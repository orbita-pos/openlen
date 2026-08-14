import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { COLORING_DIRECTION, COLORING_INTENT } from "@/lib/generation/creative-fixtures.test-support";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

import type { SafeCreativeCandidate } from "./ai-creation-contracts";
import type { CreativeDocumentCandidate, CreativeDocumentOutcome } from "./creative-document";
import { runAiCreation, type RunAiCreationDeps, type RunAiCreationInput } from "./run-ai-creation";

const INTENT = IntentAnalysisSchema.parse(COLORING_INTENT);
const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);

const BASELINE_HTML = "<!doctype html><html><head><title>Base</title></head><body><p>base</p></body></html>";
const DOCUMENT_HTML = "<!doctype html><html><head><title>Mundo Pincel</title></head><body><h1>Colorea</h1></body></html>";

const PROFILE = { business_name: "Mundo Pincel", brand: { accent: "#f06aa6", logoUrl: null } } as BusinessProfileData;
const COPY = { business_name: "Mundo Pincel" } as ExtractedBusinessData;

const COMPOSED_METADATA = {
  schemaVersion: "visual-engine-project/1.0",
  route: "section_composition",
  templateId: null,
  creativeDirection: DIRECTION,
  promptVersion: "p/1.0",
  policyVersion: "ai-hybrid-policy/1.0",
  contractVersion: "creative-direction/1.0",
  compositionManifest: {},
} as unknown as Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;

const DOCUMENT_METADATA = {
  schemaVersion: "visual-engine-project/1.0",
  route: "creative_document",
  templateId: null,
  creativeDirection: DIRECTION,
  promptVersion: "creative-document/1.0",
  policyVersion: "ai-hybrid-policy/1.0",
  contractVersion: "creative-direction/1.0",
  documentManifest: {},
} as unknown as Extract<VisualEngineProjectMetadata, { route: "creative_document" }>;

const BASELINE_CANDIDATE: SafeCreativeCandidate = {
  html: BASELINE_HTML,
  title: "Mundo Pincel",
  visualEngine: COMPOSED_METADATA,
  filled: true,
  appliedOps: 7,
  source: "baseline",
};

const DOCUMENT_CANDIDATE: CreativeDocumentCandidate = {
  html: DOCUMENT_HTML,
  title: "Mundo Pincel",
  visualEngine: DOCUMENT_METADATA,
  source: "document",
};

const INPUT: RunAiCreationInput = {
  projectId: "proj-1",
  brief: "una pagina infantil de coloreo",
  profileData: PROFILE,
  assetMode: "off",
};

function runtimeStub() {
  return {
    pageBudget: {} as never,
    fireworksClient: {} as never,
    documentClient: { write: vi.fn() } as never,
    glmSectionProgramProvider: {} as never,
    geminiAssetPackProvider: {} as never,
    inputAdapters: {} as never,
    recordModel: vi.fn(),
    recordImage: vi.fn(),
    recordFailure: vi.fn(async () => {}),
    recordDelivered: vi.fn(async () => {}),
    runFinalGate: vi.fn(),
  };
}

let runtime: ReturnType<typeof runtimeStub>;

function documentOutcome(
  candidate: CreativeDocumentCandidate | null,
  stoppedBy: CreativeDocumentOutcome["stoppedBy"],
): CreativeDocumentOutcome {
  return { candidate, turns: candidate ? 1 : 2, rejections: [], stoppedBy };
}

function deps(overrides: Partial<RunAiCreationDeps> = {}): RunAiCreationDeps {
  return {
    createFableRuntimeComposition: () => runtime as never,
    listSections: vi.fn(async () => [{ id: "sec-1" }]) as never,
    buildCreativeBaseline: vi.fn(async () => ({ ok: true, candidate: BASELINE_CANDIDATE, intent: INTENT, copy: COPY })) as never,
    runCreativeDocument: vi.fn(async () => documentOutcome(DOCUMENT_CANDIDATE, "authored")) as never,
    validateAiCompositionDelivery: vi.fn(() => ({ ok: true, visualEngine: COMPOSED_METADATA })) as never,
    validateCreativeDocumentDelivery: vi.fn(() => ({ ok: true, visualEngine: DOCUMENT_METADATA })) as never,
    ...overrides,
  };
}

beforeEach(() => {
  runtime = runtimeStub();
});

describe("runAiCreation delivery", () => {
  it("delivers the authored document when the creative pass succeeds", async () => {
    const result = await runAiCreation(INPUT, deps());

    expect(result).toMatchObject({
      ok: true,
      route: "creative_document",
      templateId: null,
      title: "Mundo Pincel",
      html: DOCUMENT_HTML,
    });
  });

  it("passes the runtime document client and the baseline direction into the creative pass", async () => {
    const runCreativeDocument = vi.fn(async () => documentOutcome(DOCUMENT_CANDIDATE, "authored"));
    await runAiCreation(INPUT, deps({ runCreativeDocument: runCreativeDocument as never }));

    const [callInput, callDeps] = runCreativeDocument.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(callInput).toMatchObject({ requestId: "proj-1", brief: INPUT.brief, title: "Mundo Pincel", creativeDirection: DIRECTION });
    expect(callDeps.client).toBe(runtime.documentClient);
  });

  it("acknowledges delivery through the shared runtime telemetry", async () => {
    const result = await runAiCreation(INPUT, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await result.finalizeFableTelemetry?.();
    expect(runtime.recordDelivered).toHaveBeenCalledTimes(1);
  });
});

// The point of the cutover: once a baseline exists, nothing a provider does
// may turn this request into a failure.
describe("runAiCreation fail-soft matrix", () => {
  it.each([
    ["provider failure", documentOutcome(null, "provider")],
    ["budget exhausted", documentOutcome(null, "budget")],
    ["both documents rejected", documentOutcome(null, "rejected")],
  ])("delivers the baseline on %s", async (_label, outcome) => {
    const result = await runAiCreation(INPUT, deps({ runCreativeDocument: vi.fn(async () => outcome) as never }));

    expect(result).toMatchObject({ ok: true, route: "section_composition", html: BASELINE_HTML, appliedOps: 7 });
  });

  it("delivers the baseline when the creative pass throws", async () => {
    const result = await runAiCreation(INPUT, deps({
      runCreativeDocument: vi.fn(async () => { throw new Error("boom"); }) as never,
    }));

    expect(result).toMatchObject({ ok: true, route: "section_composition", html: BASELINE_HTML });
  });

  it("delivers the baseline when an authored document fails the document gate", async () => {
    const result = await runAiCreation(INPUT, deps({
      validateCreativeDocumentDelivery: vi.fn(() => ({ ok: false, reasonCode: "unsealed_document" })) as never,
    }));

    expect(result).toMatchObject({ ok: true, route: "section_composition", html: BASELINE_HTML });
    expect(runtime.recordFailure).toHaveBeenCalledWith("creative_document", "semantic_gate_failed");
  });

  it("delivers the baseline when the document gate itself throws", async () => {
    const result = await runAiCreation(INPUT, deps({
      validateCreativeDocumentDelivery: vi.fn(() => { throw new Error("gate down"); }) as never,
    }));

    expect(result).toMatchObject({ ok: true, route: "section_composition", html: BASELINE_HTML });
  });

  it("still delivers when telemetry recording rejects", async () => {
    runtime.recordFailure = vi.fn(async () => { throw new Error("sink down"); });
    const result = await runAiCreation(INPUT, deps({
      runCreativeDocument: vi.fn(async () => documentOutcome(null, "provider")) as never,
    }));

    expect(result).toMatchObject({ ok: true, route: "section_composition" });
  });

  it("reports progress for the baseline and creative stages", async () => {
    const stages: string[] = [];
    await runAiCreation({ ...INPUT, onStage: (stage) => stages.push(stage) }, deps());

    expect(stages).toEqual(["sections", "baseline", "creative_document", "delivery_gate"]);
  });
});

// The only remaining hard failures are the ones with nothing to deliver.
describe("runAiCreation hard failures", () => {
  it("fails when no published section inventory exists", async () => {
    const result = await runAiCreation(INPUT, deps({ listSections: vi.fn(async () => []) as never }));

    expect(result).toMatchObject({ ok: false, stage: "sections", reasonCode: "section_inventory_unavailable" });
  });

  it("fails when the inventory lookup throws", async () => {
    const result = await runAiCreation(INPUT, deps({ listSections: vi.fn(async () => { throw new Error("db"); }) as never }));

    expect(result).toMatchObject({ ok: false, stage: "sections" });
  });

  it("fails before any paid work when no safe baseline can be built", async () => {
    const runCreativeDocument = vi.fn(async () => documentOutcome(DOCUMENT_CANDIDATE, "authored"));
    const result = await runAiCreation(INPUT, deps({
      buildCreativeBaseline: vi.fn(async () => ({ ok: false, code: "baseline_invalid" })) as never,
      runCreativeDocument: runCreativeDocument as never,
    }));

    expect(result).toMatchObject({ ok: false, stage: "baseline", reasonCode: "baseline_invalid" });
    expect(runCreativeDocument).not.toHaveBeenCalled();
  });

  it("maps a missing inventory reported by the baseline builder", async () => {
    const result = await runAiCreation(INPUT, deps({
      buildCreativeBaseline: vi.fn(async () => ({ ok: false, code: "section_inventory_unavailable" })) as never,
    }));

    expect(result).toMatchObject({ ok: false, stage: "baseline", reasonCode: "section_inventory_unavailable" });
  });

  it("fails when the baseline cannot pass its own delivery gate", async () => {
    const result = await runAiCreation(INPUT, deps({
      runCreativeDocument: vi.fn(async () => documentOutcome(null, "provider")) as never,
      validateAiCompositionDelivery: vi.fn(() => ({ ok: false, reasonCode: "section_role_coverage_failed" })) as never,
    }));

    expect(result).toMatchObject({ ok: false, stage: "delivery_gate", reasonCode: "semantic_gate_failed" });
  });

  it("fails when the composition root cannot be created", async () => {
    const result = await runAiCreation(INPUT, deps({
      createFableRuntimeComposition: () => { throw new Error("no budget env"); },
    }));

    expect(result).toMatchObject({ ok: false, stage: "baseline", reasonCode: "baseline_invalid" });
  });
});
