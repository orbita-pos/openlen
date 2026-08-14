import { describe, expect, it } from "vitest";

import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import { createGlmVisualRepairProvider, createVisualRepairMachine, type GlmVisualRepairProvider } from "./glm-visual-repair";

const program = {
  schemaVersion: "expressive-section-program/1.0" as const,
  role: "hero" as const,
  root: { kind: "layout" as const, id: "root", preset: "stack" as const, gap: "md" as const, padding: "lg" as const, width: "wide" as const, align: "stretch" as const, justify: "between" as const, columns: "one" as const, color: "surface" as const, radius: "lg" as const, border: "hairline" as const, transform: "none" as const, blend: "normal" as const, children: [{ kind: "copy" as const, id: "title", variant: "heading" as const, copyKey: "hero.title", tone: "strong" as const, size: "2xl" as const, color: "ink" as const, align: "start" as const }] },
  responsive: { mobile: [] }, motion: [],
};

const handoff = {
  schemaVersion: "adaptive-section-repair-handoff/1.0" as const,
  entries: [{ ordinal: 0, action: "generate" as const, role: "hero" as const, provenance: { schemaVersion: "section-decision-provenance/1.0" as const, action: "generate" as const, candidateId: null, usefulTraits: [], sourceTemplateId: null, sourceBandOrdinal: null, sourceContentHash: null, sourceStructuralFingerprint: null }, allowedCopyKeys: ["hero.title"], allowedAssetSlots: [], compiledFragmentId: "expressive-hero-old", compiledContentHash: "a".repeat(12), compiledFragmentHash: `sha256:${"a".repeat(64)}`, structuralFingerprint: `sha256:${"b".repeat(64)}`, programId: "expressive-hero-old", programHash: `sha256:${"c".repeat(64)}`, program }],
};
const design = { schemaVersion: "adaptive-page-design/1.0" as const, narrative: ["hero" as const], direction: { ...COLORING_DIRECTION, requiredVisualSignals: ["friendly", "playful"] }, decisions: [{ ordinal: 0, action: "generate" as const, candidateId: null, usefulTraits: [], rejectedTraits: [] }], rhythm: "playful" as const, requiredSignals: ["friendly", "playful"], forbiddenSignals: ["corporate"], imageSlots: [] } as unknown as import("./adaptive-design-contracts").AdaptivePageDesignProgram;

describe("createVisualRepairMachine", () => {
  it("normalizes fixed repair versions and omitted empty program containers before validation", async () => {
    const { responsive: _responsive, motion: _motion, ...sparseProgram } = program;
    const client: FireworksJsonClient = {
      async request(request) {
        return {
          ok: true as const,
          value: request.responseSchema.parse({ changes: [{ programId: "expressive-hero-old", program: sparseProgram }] }),
          modelId: "accounts/fireworks/models/glm-5p2",
          usage: { inputTokens: 9, cachedTokens: 0, outputTokens: 4, thinkingTokens: 1 },
          durationMs: 3,
          attempts: 1 as const,
        };
      },
    };
    const result = await createGlmVisualRepairProvider({ client }).repair({
      requestId: "page-repair",
      design,
      programs: [{ programId: "expressive-hero-old", role: "hero", allowedCopyKeys: ["hero.title"], allowedAssetSlots: [], program }],
      issues: [{ code: "originality", severity: "major", viewport: "desktop" }],
    });

    expect(result).toMatchObject({
      ok: true,
      delta: {
        schemaVersion: "glm-visual-repair-delta/1.0",
        changes: [{ program: { responsive: { mobile: [] }, motion: [] } }],
      },
    });
  });

  it("permits exactly one GLM delta over known program IDs and then becomes terminal", async () => {
    const calls: unknown[] = [];
    const provider: GlmVisualRepairProvider = { async repair(request) { calls.push(request); return { ok: true as const, delta: { schemaVersion: "glm-visual-repair-delta/1.0" as const, changes: [{ programId: "expressive-hero-old", program: { ...program, root: { ...program.root, preset: "layered" as const } } }] }, modelId: "accounts/fireworks/models/glm-5p2", usage: { inputTokens: 9, cachedTokens: 0, outputTokens: 4, thinkingTokens: 1 }, durationMs: 3, attempts: 1 as const }; } };
    const machine = createVisualRepairMachine({ design, handoff, issues: [{ code: "originality", severity: "major", viewport: "desktop" }] }, { provider });

    const repaired = await machine.requestRepair();
    expect(repaired).toMatchObject({ ok: true, state: "repaired", delta: { changes: [{ programId: "expressive-hero-old" }] } });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).not.toMatch(/html|css|https?:|private-copy/i);
    await expect(machine.requestRepair()).resolves.toEqual({ ok: false, code: "repair_already_consumed" });
  });
});
