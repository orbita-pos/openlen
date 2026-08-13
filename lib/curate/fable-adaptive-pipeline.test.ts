import { describe, expect, it, vi } from "vitest";

import { runFableAdaptivePipeline } from "./fable-adaptive-pipeline";

describe("Fable adaptive production pipeline", () => {
  it("runs scout, page planning, adaptive composition and assets in order on the shared runtime", async () => {
    const events: string[] = [];
    const runtime = {
      fireworksClient: { request: vi.fn() },
      glmSectionProgramProvider: { generate: vi.fn() },
      geminiAssetPackProvider: { createPack: vi.fn() },
      recordModel: vi.fn(),
      recordImage: vi.fn(),
      recordFailure: vi.fn(),
    };
    const design = {
      schemaVersion: "adaptive-page-design/1.0",
      narrative: ["hero", "features", "footer"],
      direction: { schemaVersion: "creative-direction/1.0" },
      decisions: [],
      rhythm: "playful",
      requiredSignals: [], forbiddenSignals: [], imageSlots: [],
    };
    const repairedHtml = "<!doctype html><html><body>REPAIRED</body></html>";
    const applyDelta = vi.fn(async () => ({
      ok: true as const,
      html: repairedHtml,
      manifest: { outputHash: "sha256:repaired" },
      handoff: { schemaVersion: "adaptive-section-repair-handoff/1.0", entries: [{ programId: "program-1" }] },
    }));
    const composeAdaptiveSections = vi.fn(async (input, deps) => {
      events.push("compose");
      expect(deps.provider).toBe(runtime.glmSectionProgramProvider);
      expect(input.design).toBe(design);
      return {
        ok: true as const,
        status: "composed" as const,
        html: "<!doctype html><html><body>INITIAL</body></html>",
        manifest: { outputHash: "sha256:initial" },
        telemetry: [],
        handoff: { schemaVersion: "adaptive-section-repair-handoff/1.0", entries: [{ programId: "program-1" }] },
        applyDelta,
      };
    });
    const result = await runFableAdaptivePipeline({
      projectId: "project-1",
      assetMode: "hybrid",
      candidateTitle: "Mundo Pincel",
      copy: { business_name: "Mundo Pincel" },
      profileData: { brand: { accent: "#F06AA6", logoUrl: null } },
      intent: {
        functional: { siteType: "coloring_pages" },
        audience: { primary: "children", ageRange: null, secondary: ["parents"] },
        domains: ["creative_play"], emotionalGoals: ["playful"],
        requiredVisualSignals: [], forbiddenVisualSignals: [],
      },
      intentHash: `sha256:${"a".repeat(64)}`,
      records: [],
      policyVersion: "ai-hybrid-policy/1.0",
    } as never, {
      runtime: runtime as never,
      finalize: ({ html }) => { events.push("finalize"); return { ok: true as const, html: `${html}|FINAL` }; },
      buildInventory: () => ({ hash: `sha256:${"b".repeat(64)}`, entries: [] }) as never,
      planAdaptive: () => { events.push("plan"); return { ok: true as const, plan: { rows: [{ requestedRole: "hero" }, { requestedRole: "features" }, { requestedRole: "footer" }] } as never }; },
      buildInitialDirection: () => ({ direction: { schemaVersion: "creative-direction/1.0" } }) as never,
      scoutCandidates: async (_input, deps) => {
        events.push("scout");
        expect(deps.client).toBe(runtime.fireworksClient);
        return { ok: true as const, requiredRoles: ["hero", "features", "footer"], candidates: [], decisions: [], modelId: "qwen", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 } as never;
      },
      createPageDesign: async (_input, deps) => {
        events.push("design");
        expect(deps.client).toBe(runtime.fireworksClient);
        return { ok: true as const, program: design, modelId: "deepseek", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 } as never;
      },
      composeAdaptiveSections: composeAdaptiveSections as never,
      adaptiveCompositionDeps: {} as never,
      resolveAssets: async (_input, deps) => {
        events.push("assets");
        expect(deps.provider).toBe(runtime.geminiAssetPackProvider);
        return { ok: true as const, html: "<!doctype html><html><body>INITIAL+ASSET</body></html>", assetManifest: undefined, assetTrace: undefined };
      },
      sealFinal: ((html: string) => ({ html, sealed: true })) as never,
      buildVisualEngine: ({ html }) => ({ html, visualEngine: { compositionManifest: { outputHash: "sha256:initial" } } as never }),
    });

    expect(result).toMatchObject({ ok: true, html: "<!doctype html><html><body>INITIAL+ASSET</body></html>|FINAL" });
    expect(events).toEqual(["plan", "scout", "design", "compose", "assets", "finalize"]);
    expect(result.ok && result.fableVisualRepairHandoff?.applyDelta).toEqual(expect.any(Function));

    const repaired = result.ok ? await result.fableVisualRepairHandoff!.applyDelta!({
      schemaVersion: "glm-visual-repair-delta/1.0",
      changes: [{ programId: "program-1", program: {} as never }],
    }) : { ok: false };
    expect(applyDelta).toHaveBeenCalledOnce();
    expect(repaired).toMatchObject({ ok: true, candidate: { html: `${repairedHtml}|FINAL` } });
  });
});
