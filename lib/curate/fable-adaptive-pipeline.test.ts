import { describe, expect, it, vi } from "vitest";

import { fetchAuthoritativeSectionText, runFableAdaptivePipeline } from "./fable-adaptive-pipeline";

describe("Fable adaptive production pipeline", () => {
  it("reads canonical section objects from origin instead of transformed CDN bytes", async () => {
    const readObject = vi.fn(async () => "<footer>authoritative</footer>");
    const fetchImpl = vi.fn();
    await expect(fetchAuthoritativeSectionText(
      "https://templates.openlen.com/sections/derived-footer-aaaaaaaaaaaa.html",
      { readObject, fetchImpl: fetchImpl as never },
    )).resolves.toBe("<footer>authoritative</footer>");
    expect(readObject).toHaveBeenCalledWith("sections/derived-footer-aaaaaaaaaaaa.html");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

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
      const assetBinding = await deps.beforeCompile({ plan: input.plan, design: input.design, usedAssetSlots: [] });
      if (!assetBinding.ok) return { ok: false as const, reasonCode: "required_asset_unavailable", telemetry: [] };
      const bound = assetBinding.bind("<!doctype html><html><body>INITIAL</body></html>", []);
      if (!bound.ok) return { ok: false as const, reasonCode: "required_asset_unavailable", telemetry: [] };
      return {
        ok: true as const,
        status: "composed" as const,
        html: bound.html,
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
        return {
          ok: true as const,
          assetManifest: undefined,
          assetTrace: undefined,
          bind: (html: string) => ({ ok: true as const, html: html.replace("INITIAL", "INITIAL+ASSET") }),
          reapply: (html: string) => ({ ok: true as const, html }),
        };
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

  it("ships the page when a required image slot was never placed instead of failing the whole run", async () => {
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
      requiredSignals: [], forbiddenSignals: [],
      imageSlots: [{ slotIndex: 0, ordinal: 0, mediaType: "photo", subject: "children_painting", purpose: "hero_identity", required: true }],
    };
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
      finalize: ({ html }) => ({ ok: true as const, html }),
      buildInventory: () => ({ hash: `sha256:${"b".repeat(64)}`, entries: [] }) as never,
      planAdaptive: () => ({ ok: true as const, plan: { rows: [{ requestedRole: "hero" }, { requestedRole: "features" }, { requestedRole: "footer" }] } as never }),
      buildInitialDirection: () => ({ direction: { schemaVersion: "creative-direction/1.0" } }) as never,
      scoutCandidates: async () => ({ ok: true as const, requiredRoles: ["hero", "features", "footer"], candidates: [], decisions: [], modelId: "qwen", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 } as never),
      createPageDesign: async () => ({ ok: true as const, program: design, modelId: "deepseek", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 } as never),
      composeAdaptiveSections: (async (input: never, deps: never) => {
        const binding = await (deps as { beforeCompile: (arg: unknown) => Promise<{ ok: boolean; bind?: (html: string, slots: number[]) => { ok: true; html: string } }> })
          .beforeCompile({ plan: (input as { plan: unknown }).plan, design, usedAssetSlots: [] });
        if (!binding.ok) return { ok: false as const, reasonCode: "required_asset_unavailable", telemetry: [] };
        return {
          ok: true as const,
          status: "composed" as const,
          html: binding.bind!("<!doctype html><html><body>NO PHOTO</body></html>", []).html,
          manifest: { outputHash: "sha256:initial" },
          telemetry: [],
          handoff: { schemaVersion: "adaptive-section-repair-handoff/1.0", entries: [] },
        };
      }) as never,
      adaptiveCompositionDeps: {} as never,
      sealFinal: ((html: string) => ({ html, sealed: true })) as never,
      buildVisualEngine: ({ html }) => ({ html, visualEngine: { compositionManifest: { outputHash: "sha256:initial" } } as never }),
    });

    expect(result).toMatchObject({ ok: true, html: "<!doctype html><html><body>NO PHOTO</body></html>" });
  });

  it.each(["scout", "page_plan"] as const)("records a failed paid %s attempt before flushing failure telemetry", async (failedStage) => {
    const events: string[] = [];
    const runtime = {
      fireworksClient: { request: vi.fn() },
      glmSectionProgramProvider: { generate: vi.fn() },
      geminiAssetPackProvider: { createPack: vi.fn() },
      recordModel: vi.fn((stage: string, result: { modelId?: string }) => events.push(`model:${stage}:${result.modelId}`)),
      recordImage: vi.fn(),
      recordFailure: vi.fn(async (stage: string) => { events.push(`failure:${stage}`); }),
    };
    const paidFailure = {
      ok: false as const,
      code: "provider_error" as const,
      modelId: failedStage === "scout" ? "qwen-paid-failure" : "deepseek-paid-failure",
      usage: { inputTokens: 13, cachedTokens: 0, outputTokens: 2, thinkingTokens: 1 },
      durationMs: 17,
      attempts: 2 as const,
    };
    const scoutSuccess = {
      ok: true as const,
      requiredRoles: ["hero"], candidates: [], decisions: [],
      modelId: "qwen-success", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }, durationMs: 1, attempts: 1 as const,
    };

    const result = await runFableAdaptivePipeline({
      projectId: "project-paid-failure",
      copy: {}, records: [], profileData: {}, candidateTitle: "Safe",
      intent: { functional: { siteType: "landing" }, audience: { primary: "general", ageRange: null, secondary: [] }, domains: [], emotionalGoals: [], requiredVisualSignals: [], forbiddenVisualSignals: [] },
      intentHash: `sha256:${"a".repeat(64)}`, policyVersion: "ai-hybrid-policy/1.0", assetMode: "curated",
    } as never, {
      runtime: runtime as never,
      buildInventory: () => ({ hash: `sha256:${"b".repeat(64)}`, entries: [] }) as never,
      planAdaptive: () => ({ ok: true as const, plan: { rows: [{ requestedRole: "hero" }] } }) as never,
      buildInitialDirection: () => ({ direction: { schemaVersion: "creative-direction/1.0" } }) as never,
      scoutCandidates: async () => failedStage === "scout" ? paidFailure as never : scoutSuccess as never,
      createPageDesign: async () => paidFailure as never,
      finalize: vi.fn() as never,
    });

    expect(result).toMatchObject({ ok: false, reasonCode: "provider_error" });
    expect(events).toEqual(failedStage === "scout"
      ? ["model:scout:qwen-paid-failure", "failure:scout"]
      : ["model:scout:qwen-success", "model:page_plan:deepseek-paid-failure", "failure:page_plan"]);
  });
});
