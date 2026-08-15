import { describe, expect, it, vi } from "vitest";

import { generateExpressiveMissingSection, generateMissingSection } from "./generate-missing-section";

const row = {
  ordinal: 2, requestedRole: "activities" as const, componentType: "features" as const,
  compatibilityKind: "structural" as const, compatibilityScore: 0.85,
  compatibilityRuleId: "section_component:structural:activities>features", required: true as const,
};
const spec = {
  schemaVersion: "generated-section-spec/1.0" as const, role: "activities" as const, layout: "grid" as const,
  blocks: [{ kind: "heading" as const, copyKey: "activities.title" }, { kind: "cards" as const, copyKeys: ["activities.one", "activities.two"] }],
  geometry: { density: "balanced" as const, emphasis: "copy" as const },
};
function deps(overrides: Record<string, unknown> = {}) {
  return {
    provider: { generate: vi.fn(async () => ({ ok: true as const, spec, modelId: "gemini", promptVersion: "generated-section-spec-prompt/1.0" as const, usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, cachedTokens: 0 }, durationMs: 4 })) },
    compileGenerated: vi.fn(async (draft: { id: string; html: string }) => ({ ok: true as const, section: {
      id: draft.id, html: draft.html, type: "features" as const, mode: "light" as const,
      provenance: { schemaVersion: "derived-section-provenance/1.0" as const, sourceTemplateId: "generated-source", sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: 0, extractionVersion: "template-band-extractor/1.0" as const, sourceHash: `sha256:${"a".repeat(64)}`, structuralFingerprint: `sha256:${"b".repeat(64)}` },
      semantics: { schemaVersion: "derived-section-semantics/1.0" as const, role: "features" as const, layoutArchetypes: ["grid" as const], domains: ["children_creativity" as const], audiences: ["children" as const], moods: ["playful" as const], negativeSignals: [] },
      designTokens: {}, fonts: [], needsJs: false, hasPlaceholders: false,
      contentHash: "c".repeat(12), renderScore: 90, sourceExactHash: `sha256:${"d".repeat(64)}`,
    } })),
    ...overrides,
  };
}
const input = {
  row,
  request: {
    intent: { domains: ["creative_play"], audiences: ["children"], requiredSignals: ["playful"], forbiddenSignals: ["dashboard"] },
    direction: { visualArchetype: "illustrated_activity_book", emotionalTone: ["playful"], density: "balanced" as const },
    copyKeys: ["activities.title", "activities.one", "activities.two"], assetSlots: [],
  },
  copy: { "activities.title": "Actividades", "activities.one": "Pinta", "activities.two": "Crea" },
};

describe("generateMissingSection", () => {
  it("requests and repository-compiles one expressive missing section", async () => {
    const expressiveProgram = {
      schemaVersion: "expressive-section-program/1.0" as const,
      role: "activities" as const,
      root: { kind: "copy" as const, id: "title", variant: "heading" as const, copyKey: "activities.title", tone: "strong" as const, size: "2xl" as const, color: "ink" as const, align: "start" as const },
      responsive: { mobile: [] }, motion: [],
    };
    const provider = { generate: vi.fn(async () => ({
      ok: true as const, program: expressiveProgram, modelId: "glm", promptVersion: "glm-section-program-prompt/1.1" as const,
      usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 as const,
    })) };
    const provenance = { schemaVersion: "section-decision-provenance/1.0" as const, action: "generate" as const, candidateId: null, sourceTemplateId: null, sourceBandOrdinal: null, sourceContentHash: null, sourceStructuralFingerprint: null, usefulTraits: [] };
    const result = await generateExpressiveMissingSection({
      request: { mode: "generate", requestId: "page.section-2", ordinal: 2, role: "activities", direction: { rhythm: "playful", requiredSignals: ["playful"], forbiddenSignals: ["corporate"] }, copyKeys: ["activities.title"], assetSlots: [] },
      copy: { "activities.title": "Escaped <title>" }, provenance,
    }, { provider });
    expect(result).toMatchObject({ ok: true, draft: { role: "activities", provenance } });
    expect(result.ok && result.draft.html).toContain("Escaped &lt;title&gt;");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("rejects forged request and provenance mode mismatches before invoking the provider", async () => {
    const provider = { generate: vi.fn() };
    const result = await generateExpressiveMissingSection({
      request: { mode: "generate", requestId: "page.section-2", ordinal: 2, role: "activities", direction: { rhythm: "playful", requiredSignals: ["playful"], forbiddenSignals: ["corporate"] }, copyKeys: ["activities.title"], assetSlots: [] },
      copy: { "activities.title": "Escaped <title>" },
      provenance: { schemaVersion: "section-decision-provenance/1.0", action: "rebuild", candidateId: "donor", sourceTemplateId: "template", sourceBandOrdinal: 0, sourceContentHash: "a".repeat(12), sourceStructuralFingerprint: `sha256:${"a".repeat(64)}`, usefulTraits: [] },
    } as never, { provider });
    expect(result).toEqual({ ok: false, code: "invalid_input" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("makes one spec request, compiles repository markup, and returns a generated candidate", async () => {
    const d = deps(); const result = await generateMissingSection(input, d);
    expect(result).toMatchObject({ ok: true, candidate: { sourceKind: "generated", sourceTemplateId: null, sourceBandOrdinal: null, type: "features" }, usage: { inputTokens: 10 } });
    expect(d.provider.generate).toHaveBeenCalledTimes(1);
    expect(d.compileGenerated).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("<script>");
  });

  it("rejects unknown copy references and wrong roles before compilation", async () => {
    for (const bad of [
      { ...spec, role: "stories" as const },
      { ...spec, blocks: [{ kind: "heading" as const, copyKey: "unknown.key" }, spec.blocks[1]] },
    ]) {
      const d = deps({ provider: { generate: vi.fn(async () => ({ ok: true as const, spec: bad, modelId: "gemini", promptVersion: "generated-section-spec-prompt/1.0" as const, durationMs: 1 })) } });
      const result = await generateMissingSection(input, d);
      expect(result).toMatchObject({ ok: false, code: "invalid_provider_response" });
      expect(result).not.toHaveProperty("candidate");
      expect(d.compileGenerated).not.toHaveBeenCalled();
    }
  });

  it("returns no candidate when provider or shared compiler fails", async () => {
    const providerFailure = deps({ provider: { generate: vi.fn(async () => ({ ok: false as const, code: "timeout" as const, modelId: "gemini", promptVersion: "generated-section-spec-prompt/1.0" as const, durationMs: 3 })) } });
    expect(await generateMissingSection(input, providerFailure)).toMatchObject({ ok: false, code: "provider_timeout" });
    const compilerFailure = deps({ compileGenerated: vi.fn(async () => ({ ok: false as const, code: "mobile_overflow" as const })) });
    expect(await generateMissingSection(input, compilerFailure)).toMatchObject({ ok: false, code: "model_incompatible", usage: { inputTokens: 10 } });
  });

  it("encodes the mapped component type so non-literal roles compile deterministically", async () => {
    const d = deps();
    const compileGenerated = vi.fn(async (draft: { id: string; html: string }) => {
      const compiled = await d.compileGenerated(draft);
      if (!compiled.ok) return compiled;
      return { ok: true as const, section: { ...compiled.section, id: draft.id, type: "about" as const } };
    });
    const result = await generateMissingSection({ ...input, row: { ...row, requestedRole: "stories", componentType: "about" }, request: input.request }, {
      ...d,
      provider: { generate: vi.fn(async () => ({ ok: true as const, spec: { ...spec, role: "stories" as const }, modelId: "gemini", promptVersion: "generated-section-spec-prompt/1.0" as const, durationMs: 1 })) },
      compileGenerated,
    });
    expect(result).toMatchObject({ ok: true, candidate: { type: "about" } });
    expect(compileGenerated.mock.calls[0][0].id).toContain("generated-about-stories-");
  });
});
