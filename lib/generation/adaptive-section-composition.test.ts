import { describe, expect, it, vi } from "vitest";

import { AdaptivePageDesignProgramSchema } from "./adaptive-design-contracts";
import { CreativeDirectionSchema } from "./creative-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { sha256 } from "./content-hash";
import type { CompileDerivedSectionResult } from "./derived-section-compiler";
import type { ExpressiveSectionProgram } from "./expressive-section-contracts";
import type { GlmSectionProgramProvider, GlmSectionProgramRequest } from "./glm-section-program-provider";
import { composeAdaptiveSections, type AdaptiveSectionCompositionDeps } from "./adaptive-section-composition";
import type { SectionCompositionInventory } from "./section-inventory";
import { SectionPlanSchema } from "./section-composition-contracts";
import type { VisualScoutSuccess } from "./visual-candidate-scout";
import type { SectionFragment } from "@/lib/sections/assemble";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const DONOR_HERO = '<header data-sec="chosen-hero"><h1>Verified hero donor</h1></header>';
const DONOR_FOOTER = '<footer data-sec="chosen-footer"><p>Verified footer donor</p></footer>';
const hash12 = (html: string) => sha256(html).replace(/^sha256:/, "").slice(0, 12);

const rows = [
  { ordinal: 0, requestedRole: "hero", componentType: "hero", compatibilityKind: "exact", compatibilityScore: 1, compatibilityRuleId: "section_component:exact:hero", required: true },
  { ordinal: 1, requestedRole: "activities", componentType: "features", compatibilityKind: "structural", compatibilityScore: .85, compatibilityRuleId: "section_component:structural:activities>features", required: true },
  { ordinal: 2, requestedRole: "footer", componentType: "footer", compatibilityKind: "exact", compatibilityScore: 1, compatibilityRuleId: "section_component:exact:footer", required: true },
] as const;

const plan = SectionPlanSchema.parse({ schemaVersion: "section-plan/1.0", intentHash: HASH_A, inventoryHash: HASH_B, rows });
const direction = CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, requiredVisualSignals: ["friendly", "playful"] });
const decisions = [
  { ordinal: 0, action: "rebuild" as const, candidateId: "chosen-hero", usefulTraits: ["cinematic"], rejectedTraits: [] },
  { ordinal: 1, action: "generate" as const, candidateId: null, usefulTraits: ["playful"], rejectedTraits: [] },
  { ordinal: 2, action: "reuse" as const, candidateId: "chosen-footer", usefulTraits: ["editorial"], rejectedTraits: [] },
];
const design = AdaptivePageDesignProgramSchema.parse({
  schemaVersion: "adaptive-page-design/1.0",
  narrative: ["hero", "activities", "footer"],
  direction,
  decisions,
  rhythm: "cinematic",
  requiredSignals: ["friendly", "playful"],
  forbiddenSignals: ["corporate"],
  imageSlots: [],
});

const inventory: SectionCompositionInventory = {
  schemaVersion: "section-composition-inventory/2.0",
  hash: HASH_B,
  entries: [
    {
      id: "chosen-hero", type: "hero", mode: "dark", contentHash: hash12(DONOR_HERO), radiusBucket: "medium", density: "medium", needsJs: false,
      assetCapability: "none", semanticProfile: { tags: ["cinematic"], source: "derived_metadata" }, sourceKind: "template_derived",
      sourceTemplateId: "donor-one", sourceBandOrdinal: 1, structuralFingerprint: HASH_C, derivedSemantics: null,
    },
    {
      id: "chosen-footer", type: "footer", mode: "light", contentHash: hash12(DONOR_FOOTER), radiusBucket: "medium", density: "medium", needsJs: false,
      assetCapability: "none", semanticProfile: { tags: ["editorial"], source: "derived_metadata" }, sourceKind: "template_derived",
      sourceTemplateId: "donor-two", sourceBandOrdinal: 5, structuralFingerprint: `sha256:${"d".repeat(64)}`, derivedSemantics: null,
    },
  ],
};

const scout: VisualScoutSuccess = {
  ok: true,
  requiredRoles: ["hero", "activities", "footer"],
  candidates: [
    { candidateId: "chosen-hero", ordinal: 0, requestedRole: "hero", componentType: "hero", sourceKind: "template_derived", sourceTemplateId: "donor-one", sourceBandOrdinal: 1, structuralFingerprint: HASH_C, traits: ["cinematic"] },
    { candidateId: "chosen-footer", ordinal: 2, requestedRole: "footer", componentType: "footer", sourceKind: "template_derived", sourceTemplateId: "donor-two", sourceBandOrdinal: 5, structuralFingerprint: `sha256:${"d".repeat(64)}`, traits: ["editorial"] },
  ],
  decisions,
  modelId: "qwen-fixture",
  usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 },
  durationMs: 1,
  attempts: 1,
};

function program(role: ExpressiveSectionProgram["role"], copyKey: string): ExpressiveSectionProgram {
  return {
    schemaVersion: "expressive-section-program/1.0",
    role,
    root: {
      kind: "layout", id: "root", preset: role === "hero" ? "layered" : "collage", gap: "md", padding: "lg", width: "wide", align: "stretch", justify: "between", columns: "two", color: "surface", radius: "lg", border: "hairline", transform: "none", blend: "normal",
      children: [{ kind: "copy", id: "title", variant: "heading", copyKey, tone: "strong", size: "2xl", color: "ink", align: "start" }],
    },
    responsive: { mobile: [{ nodeId: "root", preset: "stack", columns: "one", gap: "sm", padding: "sm", hidden: false }] },
    motion: [{ nodeId: "title", preset: role === "hero" ? "reveal" : "stagger", intensity: "medium", delay: "short" }],
  };
}

function compiled(id: string, html: string, type: "hero" | "features" | "footer", fingerprint: string): CompileDerivedSectionResult {
  return { ok: true, section: {
    id, html, type, mode: "light",
    provenance: { schemaVersion: "derived-section-provenance/1.0", sourceTemplateId: "adaptive-source", sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: 0, extractionVersion: "template-band-extractor/1.0", sourceHash: sha256(html), structuralFingerprint: fingerprint },
    semantics: { schemaVersion: "derived-section-semantics/1.0", role: type, layoutArchetypes: [type === "features" ? "grid" : "centered"], domains: ["children_creativity"], audiences: ["children"], moods: ["playful"], negativeSignals: [] },
    designTokens: {}, fonts: [], needsJs: false, hasPlaceholders: false, contentHash: hash12(html), renderScore: 100, sourceExactHash: sha256(html),
  } };
}

function setup(overrides: Partial<AdaptiveSectionCompositionDeps> = {}) {
  const events: string[] = [];
  const providerCalls: GlmSectionProgramRequest[] = [];
  const provider: GlmSectionProgramProvider = {
    async generate(request) {
      providerCalls.push(request);
      events.push(`provider:${request.mode}:${request.ordinal}`);
      const p = request.role === "hero" ? program("hero", "hero.title") : program("activities", "activities.title");
      return { ok: true, program: p, modelId: "glm-fixture", promptVersion: "glm-section-program-prompt/1.0", usage: { inputTokens: 2, cachedTokens: 0, outputTokens: 2, thinkingTokens: 1 }, durationMs: 2, attempts: 1 };
    },
  };
  let generatedIndex = 0;
  const deps: AdaptiveSectionCompositionDeps = {
    provider,
    fetchText: vi.fn(async () => null),
    fetchFragments: vi.fn(async (selection) => {
      const row = selection[0];
      events.push(`fetch:${row.sectionId}`);
      return { ok: true as const, fragments: [{ slug: row.sectionId, type: row.componentType, requestedRole: row.requestedRole, html: row.sectionId === "chosen-hero" ? DONOR_HERO : DONOR_FOOTER }] };
    }),
    compileDerived: vi.fn(async (draft) => {
      events.push(`compile:${draft.action}:${draft.ordinal}`);
      if (draft.action === "reuse") return compiled("chosen-footer", draft.html, "footer", `sha256:${"d".repeat(64)}`);
      const fingerprints = [`sha256:${"e".repeat(64)}`, `sha256:${"f".repeat(64)}`];
      const types = ["hero", "features"] as const;
      return compiled(draft.id, draft.html, types[generatedIndex], fingerprints[generatedIndex++]);
    }),
    validateSemantics: vi.fn(async (_section, row) => { events.push(`semantics:${row.ordinal}`); return true; }),
    validateAssets: vi.fn(async (_html, row) => { events.push(`assets:${row.ordinal}`); return true; }),
    validateRender: vi.fn(async (_html, row) => { events.push(`render:${row.ordinal}`); return { ok: true as const, desktopVisible: true, mobileVisible: true, mobileOverflow: false }; }),
    sanitize: vi.fn((html) => ({ html })),
    assemble: vi.fn((fragments: SectionFragment[]) => {
      events.push("assemble");
      return `<!doctype html><html><head></head><body>${fragments.map((fragment) => fragment.html).join("")}</body></html>`;
    }),
    seal: vi.fn((html) => { events.push("seal"); return { html: `${html}<!--sealed-->`, sealed: true }; }),
    ...overrides,
  };
  return { deps, events, providerCalls };
}

const INPUT = {
  requestId: "page-atomic",
  plan,
  design,
  scout,
  inventory,
  copy: { "hero.title": "A new hero", "activities.title": "Make something" },
};

describe("adaptive section composition", () => {
  it("executes decisions in page order, reuses exact bytes, gates every output, then seals atomically", async () => {
    const d = setup();
    const result = await composeAdaptiveSections(INPUT, d.deps);
    expect(result).toMatchObject({
      ok: true,
      status: "composed",
      manifest: {
        schemaVersion: "adaptive-section-composition-manifest/1.0",
        actions: ["rebuild", "generate", "reuse"],
        selectedCandidateIds: ["chosen-hero", null, "chosen-footer"],
        resultCode: "composed",
      },
    });
    expect(result.ok && result.html).toContain(DONOR_FOOTER);
    expect(d.providerCalls.map((request) => request.mode)).toEqual(["rebuild", "generate"]);
    expect(d.providerCalls[0]).toMatchObject({ role: "hero", inspiration: { candidateId: "chosen-hero", verifiedFragmentHtml: DONOR_HERO } });
    expect(d.providerCalls[1]).not.toHaveProperty("inspiration");
    expect(d.deps.fetchFragments).toHaveBeenNthCalledWith(1, expect.anything(), inventory, { fetchText: d.deps.fetchText });
    expect(d.events).toEqual([
      "fetch:chosen-hero", "provider:rebuild:0", "compile:rebuild:0", "semantics:0", "assets:0", "render:0",
      "provider:generate:1", "compile:generate:1", "semantics:1", "assets:1", "render:1",
      "fetch:chosen-footer", "compile:reuse:2", "semantics:2", "assets:2", "render:2", "assemble", "seal",
    ]);
    expect(d.deps.sanitize).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(result.manifest)).not.toMatch(/A new hero|Make something|Verified hero donor|https?:/i);
    expect(result.ok && result.handoff).toMatchObject({
      schemaVersion: "adaptive-section-repair-handoff/1.0",
      entries: [
        { ordinal: 0, action: "rebuild", programId: expect.any(String), program: { role: "hero" }, provenance: { action: "rebuild" }, allowedCopyKeys: ["hero.title", "activities.title"], allowedAssetSlots: [] },
        { ordinal: 1, action: "generate", programId: expect.any(String), program: { role: "activities" }, provenance: { action: "generate" }, allowedCopyKeys: ["hero.title", "activities.title"], allowedAssetSlots: [] },
        { ordinal: 2, action: "reuse", programId: null, program: null, provenance: { action: "reuse" }, allowedCopyKeys: [], allowedAssetSlots: [] },
      ],
    });
    expect(JSON.stringify(result.ok && result.handoff)).not.toMatch(/A new hero|Make something|Verified hero donor|<header/i);
  });

  it("returns a typed atomic failure with no HTML when provider or a section gate fails", async () => {
    const providerFailure = setup({
      provider: { generate: vi.fn(async () => ({ ok: false as const, code: "schema" as const, modelId: "glm", promptVersion: "glm-section-program-prompt/1.0" as const, usage: { inputTokens: 2, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 2, attempts: 1 as const })) },
      assemble: vi.fn(() => "must-not-assemble"),
    });
    const first = await composeAdaptiveSections(INPUT, providerFailure.deps);
    expect(first).toMatchObject({ ok: false, reasonCode: "invalid_provider_response", telemetry: [{ usage: { inputTokens: 2 } }] });
    expect(first).not.toHaveProperty("html");
    expect(providerFailure.deps.assemble).not.toHaveBeenCalled();

    const gateFailure = setup({ validateAssets: vi.fn(async (_html, row) => row.ordinal !== 1), assemble: vi.fn(() => "must-not-assemble") });
    const second = await composeAdaptiveSections(INPUT, gateFailure.deps);
    expect(second).toMatchObject({ ok: false, reasonCode: "required_asset_unavailable" });
    expect(second).not.toHaveProperty("html");
    expect(gateFailure.deps.assemble).not.toHaveBeenCalled();
  });

  it("retains paid provider telemetry in call order through compiler and later gate failures", async () => {
    const first = program("hero", "hero.title");
    const provider: GlmSectionProgramProvider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ ok: true as const, program: first, modelId: "glm-first", promptVersion: "glm-section-program-prompt/1.0" as const, usage: { inputTokens: 3, cachedTokens: 0, outputTokens: 2, thinkingTokens: 1 }, durationMs: 4, attempts: 1 as const })
        .mockResolvedValueOnce({ ok: false as const, code: "schema" as const, modelId: "glm-second", promptVersion: "glm-section-program-prompt/1.0" as const, usage: { inputTokens: 5, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 6, attempts: 1 as const }),
    };
    const d = setup({ provider, assemble: vi.fn(() => "must-not-assemble") });
    const result = await composeAdaptiveSections(INPUT, d.deps);
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "invalid_provider_response",
      telemetry: [
        { modelId: "glm-first", usage: { inputTokens: 3 } },
        { modelId: "glm-second", usage: { inputTokens: 5 } },
      ],
    });
    expect(result).not.toHaveProperty("html");
  });

  it("retains a successful provider call when its compiler rejects the program", async () => {
    const badProgram = {
      ...program("hero", "hero.title"),
      root: { ...program("hero", "hero.title").root, copyKey: "unknown.key" },
    } as never;
    const d = setup({
      provider: { generate: vi.fn(async () => ({ ok: true as const, program: badProgram, modelId: "glm-paid", promptVersion: "glm-section-program-prompt/1.0" as const, usage: { inputTokens: 7, cachedTokens: 0, outputTokens: 3, thinkingTokens: 1 }, durationMs: 8, attempts: 1 as const })) },
      assemble: vi.fn(() => "must-not-assemble"),
    });
    const result = await composeAdaptiveSections(INPUT, d.deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "invalid_provider_response", telemetry: [{ modelId: "glm-paid", usage: { inputTokens: 7 } }] });
    expect(d.deps.assemble).not.toHaveBeenCalled();
  });

  it("rejects reuse byte drift before any assembly", async () => {
    const d = setup({
      compileDerived: vi.fn(async (draft) => draft.action === "reuse"
        ? compiled("chosen-footer", `${draft.html}<p>changed</p>`, "footer", `sha256:${"d".repeat(64)}`)
        : compiled(draft.id, draft.html, draft.ordinal === 0 ? "hero" : "features", draft.ordinal === 0 ? `sha256:${"e".repeat(64)}` : `sha256:${"f".repeat(64)}`)),
      assemble: vi.fn(() => "must-not-assemble"),
    });
    const result = await composeAdaptiveSections(INPUT, d.deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "section_fragment_stale" });
    expect(result).not.toHaveProperty("html");
    expect(d.deps.assemble).not.toHaveBeenCalled();
  });

  it.each([
    ["semantic", { validateSemantics: vi.fn(async () => false) }, "section_semantic_coverage_failed"],
    ["render", { validateRender: vi.fn(async () => ({ ok: false as const })) }, "technical_render_failed"],
    ["section sanitizer", { sanitize: vi.fn(() => ({ html: null })) }, "sanitization_failed"],
    ["assembly", { assemble: vi.fn(() => { throw new Error("private assembly state"); }) }, "internal_error"],
    ["seal", { seal: vi.fn((html: string) => ({ html, sealed: false })) }, "sanitization_failed"],
  ] as const)("fails atomically at the %s gate", async (_label, override, reasonCode) => {
    const d = setup(override);
    const result = await composeAdaptiveSections(INPUT, d.deps);
    expect(result).toMatchObject({ ok: false, reasonCode });
    expect(result).not.toHaveProperty("html");
  });

  it("fails originality when fingerprints collapse or rebuild reconstructs its donor", async () => {
    const repeatedProvider: GlmSectionProgramProvider = { async generate(request) {
      const copyKey = request.role === "hero" ? "hero.title" : "activities.title";
      return { ok: true, program: {
        schemaVersion: "expressive-section-program/1.0", role: request.role,
        root: { kind: "layout", id: `root-${request.ordinal}`, preset: "stack", gap: "md", padding: "lg", width: "wide", align: "stretch", justify: "between", columns: "one", color: "surface", radius: "lg", border: "hairline", transform: "none", blend: "normal", children: [
          { kind: "copy", id: `title-${request.ordinal}`, variant: "heading", copyKey, tone: "strong", size: "2xl", color: "ink", align: "start" },
        ] }, responsive: { mobile: [] }, motion: [],
      }, modelId: "glm", promptVersion: "glm-section-program-prompt/1.0", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 };
    } };
    const collapsed = setup({
      provider: repeatedProvider,
      assemble: vi.fn(() => "must-not-assemble"),
    });
    await expect(composeAdaptiveSections(INPUT, collapsed.deps)).resolves.toMatchObject({ ok: false, reasonCode: "section_originality_failed" });
    expect(collapsed.deps.assemble).not.toHaveBeenCalled();

    const reconstructed = setup({
      compileDerived: vi.fn(async (draft) => compiled(draft.action === "reuse" ? "chosen-footer" : draft.id, draft.html, draft.ordinal === 0 ? "hero" : draft.ordinal === 1 ? "features" : "footer", draft.ordinal === 0 ? HASH_C : draft.ordinal === 1 ? `sha256:${"f".repeat(64)}` : `sha256:${"d".repeat(64)}`)),
      assemble: vi.fn(() => "must-not-assemble"),
    });
    await expect(composeAdaptiveSections(INPUT, reconstructed.deps)).resolves.toMatchObject({ ok: false, reasonCode: "section_originality_failed" });
    expect(reconstructed.deps.assemble).not.toHaveBeenCalled();
  });
});
