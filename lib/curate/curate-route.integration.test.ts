import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  captureException: vi.fn(),
  getCreditState: vi.fn(),
  debitCredits: vi.fn(),
  creditsForUsage: vi.fn(),
  consumeToken: vi.fn(),
  createVersion: vi.fn(),
  renderProjectThumbnail: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  listTemplates: vi.fn(),
  getTemplateHtml: vi.fn(),
  pickTemplate: vi.fn(),
  pickWeighted: vi.fn(),
  safeTemplatePickerMode: vi.fn(),
  runShadowSelection: vi.fn(),
  logShadowComparisonWhenReady: vi.fn(),
  resolveProfileForCreation: vi.fn(),
  overlayProfile: vi.fn(),
  selectGenerationRoute: vi.fn(),
  fillAssembled: vi.fn(),
  normalizeBornCanonical: vi.fn(),
  seedBrandIntoHtml: vi.fn(),
  profileMeta: vi.fn(),
  ensurePageMeta: vi.fn(),
  sanitizeForPublish: vi.fn(),
  adaptTemplateSkeleton: vi.fn(),
  reserveVisualEnginePilotRun: vi.fn(),
  completeVisualEnginePilotRun: vi.fn(),
  listSections: vi.fn(),
  composeSectionCandidate: vi.fn(),
  visualRepairMode: vi.fn(),
  runQuickVisualRepair: vi.fn(),
  launchShadowVisualRepair: vi.fn(),
}));

vi.mock("@inariwatch/capture", () => ({ captureException: mocks.captureException }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { insert: mocks.insert },
  schema: { projects: { id: "projects" } },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  debitCredits: mocks.debitCredits,
  creditsForUsage: mocks.creditsForUsage,
  AUTOFILL_CREDIT_COST: 2,
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeToken: mocks.consumeToken,
  RATE_LIMITS: { autofill: { capacity: 10, refillPerSecond: 1 } },
}));
vi.mock("@/lib/projects/thumbnail", () => ({ renderProjectThumbnail: mocks.renderProjectThumbnail }));
vi.mock("@/lib/templates/store", () => ({
  listTemplates: mocks.listTemplates,
  getTemplateHtml: mocks.getTemplateHtml,
}));
vi.mock("@/lib/curate/pick-template", () => ({
  pickTemplate: mocks.pickTemplate,
  pickWeighted: mocks.pickWeighted,
}));
vi.mock("@/lib/generation/shadow-selection", () => ({
  safeTemplatePickerMode: mocks.safeTemplatePickerMode,
  runShadowSelection: mocks.runShadowSelection,
  logShadowComparisonWhenReady: mocks.logShadowComparisonWhenReady,
}));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfileForCreation }));
vi.mock("@/lib/business-profiles/overlay", () => ({ overlayProfile: mocks.overlayProfile }));
vi.mock("@/lib/generation/safe-selection", () => ({ selectGenerationRoute: mocks.selectGenerationRoute }));
vi.mock("@/lib/assemble/fill", () => ({ fillAssembled: mocks.fillAssembled }));
vi.mock("@/lib/normalize", () => ({ normalizeBornCanonical: mocks.normalizeBornCanonical }));
vi.mock("@/lib/business-profiles/seed-html", () => ({
  seedBrandIntoHtml: mocks.seedBrandIntoHtml,
  profileMeta: mocks.profileMeta,
}));
vi.mock("@/lib/publish/ensure-page-meta", () => ({ ensurePageMeta: mocks.ensurePageMeta }));
vi.mock("@/lib/html-engine", () => ({ sanitizeForPublish: mocks.sanitizeForPublish }));
vi.mock("@/lib/generation/adapt-skeleton", () => ({ adaptTemplateSkeleton: mocks.adaptTemplateSkeleton }));
vi.mock("@/lib/generation/visual-engine-pilot-store", () => ({
  reserveVisualEnginePilotRun: mocks.reserveVisualEnginePilotRun,
  completeVisualEnginePilotRun: mocks.completeVisualEnginePilotRun,
}));
vi.mock("@/lib/sections/store", () => ({ listSections: mocks.listSections }));
vi.mock("@/lib/generation/compose-sections", () => ({
  composeSectionCandidate: mocks.composeSectionCandidate,
}));
vi.mock("@/lib/generation/visual-repair-mode", () => ({ visualRepairMode: mocks.visualRepairMode }));
vi.mock("@/lib/curate/quick-visual-repair", () => ({
  runQuickVisualRepair: mocks.runQuickVisualRepair,
  launchShadowVisualRepair: mocks.launchShadowVisualRepair,
}));

import { POST } from "@/app/api/curate/route";

const VISUAL_METADATA = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["creative_play"],
  audiences: ["children"],
  ageRanges: ["age_4_9"],
  emotionalRegisters: ["playful"],
  visualArchetypes: ["creative_play"],
  visualSignals: ["coloring_art"],
  layoutTraits: ["card_grid"],
  requiredAssetTypes: ["illustration"],
  negativeTags: ["corporate_dashboard"],
  supportedSiteTypes: ["coloring_platform"],
  supportedSectionRoles: ["gallery"],
  themeability: "high",
  identityStrength: "high",
  reviewStatus: "reviewed",
} as const;

const TEMPLATES = [
  {
    id: "weighted", name: "Weighted", family: "saas", mode: "light", pitch: "Weighted baseline",
    description: "baseline", visualMetadata: VISUAL_METADATA,
  },
  {
    id: "safe-skeleton", name: "Safe skeleton", family: "playful", mode: "light", pitch: "Creative skeleton",
    description: "skeleton", visualMetadata: VISUAL_METADATA,
  },
] as const;

const INTENT = {
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: { siteType: "coloring_platform", requiredSections: ["gallery"], primaryActions: ["color"], contentModel: "activities" },
  audience: { primary: "children", ageRange: "age_4_9", secondary: ["parents"] },
  domains: ["creative_play"], emotionalGoals: ["playful"],
  requiredVisualSignals: ["coloring_art"], forbiddenVisualSignals: ["corporate_dashboard"],
  explicitConstraints: [], ambiguities: [], confidence: 0.96,
} as const;

const DIRECTION = {
  schemaVersion: "creative-direction/1.0",
  mode: "cream",
  visualArchetype: "creative_play",
  emotionalTone: ["playful"],
  palette: { background: "#FFF7FC", surface: "#FFFFFF", surfaceAlt: "#FCE7F3", foreground: "#31213A", foregroundMuted: "#6B5B73", accent: "#EC4899", accentInk: "#FFFFFF", border: "#F5B8D3" },
  typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "expressive" },
  geometry: { radius: "extra_round", radiusScale: 1.75, spacingScale: 1.15, density: "low_medium" },
  imagery: { strategy: "illustration_first", artDirection: "storybook", subjects: ["crayons"], avoid: ["corporate"] },
  iconography: { style: "rounded_filled", strokeWeight: "medium", cornerStyle: "round" },
  componentTreatment: { cards: "soft", buttons: "round", navigation: "friendly", sections: "pastel" },
  requiredVisualSignals: ["coloring_art"], forbiddenVisualSignals: ["corporate_dashboard"],
} as const;

const SAFE_SKELETON = {
  ok: true as const,
  intent: INTENT,
  decision: {
    schemaVersion: "generation-decision/1.0" as const,
    route: "template_skeleton" as const,
    templateId: "safe-skeleton",
    structuralFit: 0.9, identityFit: 0.5, adaptationCost: 0.2,
    selectedSections: [], rejectedCandidates: [],
  },
  ranked: [],
  promptVersion: "intent-prompt/1.8" as const,
  policyVersion: "template-policy/1.0" as const,
  modelId: "safe-model",
  durationMs: 5,
};

const SAFE_COMPOSITION = {
  ...SAFE_SKELETON,
  decision: { ...SAFE_SKELETON.decision, route: "section_composition" as const, templateId: null },
};

const ADAPTED = {
  ok: true as const,
  status: "adapted" as const,
  html: "ADAPTED:NORMAL:FILLED:RAW:safe-skeleton",
  creativeDirectionVersion: "creative-direction/1.0" as const,
  planVersion: "skeleton-adaptation-plan/1.0" as const,
  creativeDirection: DIRECTION,
  promptVersion: "creative-prompt/1.0",
  modelId: "creative-model",
  structuralFingerprintBefore: `sha256:${"a".repeat(64)}`,
  structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
  usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 5, cachedTokens: 0 },
  durationMs: 25,
};
const SHADOW_TRACE = {
  schemaVersion: "asset-resolution-trace/1.0" as const, manifestId: `sha256:${"f".repeat(64)}`,
  consistencyGroupCount: 1, curatedCount: 1, generatedCount: 0, abstractCount: 0,
  placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: null,
  modelId: null, promptSha256: [], estimatedCostMicromxn: 0, durationMs: 1, resultCode: "resolved" as const,
};
const SHADOW_FAILURE_TRACE = {
  ...SHADOW_TRACE, manifestId: null, consistencyGroupCount: 0, curatedCount: 0,
  requiredUnresolvedCount: 1, resultCode: "required_asset_unavailable" as const,
};

const previousVisualEngineMode = process.env.OPENLEN_VISUAL_ENGINE;
const previousAssetMode = process.env.OPENLEN_VISUAL_ENGINE_ASSETS;

interface SseEvent { event: string; data: Record<string, unknown> }

function parseSse(text: string): SseEvent[] {
  return text.trim().split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    return {
      event: lines[0]!.slice("event: ".length),
      data: JSON.parse(lines[1]!.slice("data: ".length)) as Record<string, unknown>,
    };
  });
}

async function post(): Promise<{ response: Response; events: SseEvent[] }> {
  const response = await POST(new Request("http://localhost/api/curate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief: "Una plataforma infantil para colorear y crear" }),
  }));
  return { response, events: parseSse(await response.text()) };
}

function previews(events: SseEvent[]): string[] {
  return events.filter((event) => event.event === "preview").map((event) => String(event.data.html));
}

function progress(events: SseEvent[]): string[] {
  return events.filter((event) => event.event === "progress").map((event) => String(event.data.stage));
}

describe("POST /api/curate Visual Engine integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENLEN_VISUAL_ENGINE = "off";
    process.env.OPENLEN_VISUAL_ENGINE_ASSETS = "off";
    mocks.visualRepairMode.mockReturnValue("off");
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.consumeToken.mockReturnValue({ allowed: true });
    mocks.getCreditState.mockResolvedValue({ balance: 10 });
    mocks.listTemplates.mockResolvedValue(TEMPLATES);
    mocks.pickTemplate.mockResolvedValue({
      ok: true,
      templateIds: ["weighted"],
      copy: { business_name: "Mundo Color" },
      raw: "{}",
      usage: { inputTokens: 100, outputTokens: 20 },
      durationMs: 5,
    });
    mocks.pickWeighted.mockReturnValue("weighted");
    mocks.safeTemplatePickerMode.mockReturnValue("off");
    mocks.runShadowSelection.mockResolvedValue(null);
    mocks.resolveProfileForCreation.mockResolvedValue({
      id: "profile-1",
      data: { brand: { accent: "#EC4899", logoUrl: null } },
    });
    mocks.overlayProfile.mockImplementation((copy) => copy);
    mocks.selectGenerationRoute.mockResolvedValue(SAFE_SKELETON);
    mocks.getTemplateHtml.mockImplementation(async (templateId: string) => `RAW:${templateId}`);
    mocks.fillAssembled.mockImplementation(async (html: string) => ({
      html: `FILLED:${html}`,
      filled: true,
      appliedOps: 2,
      usage: { inputTokens: 10, outputTokens: 5 },
      durationMs: 10,
      leaksBefore: 0,
      leaksAfter: 0,
    }));
    mocks.normalizeBornCanonical.mockImplementation((html: string) => `NORMAL:${html}`);
    mocks.seedBrandIntoHtml.mockImplementation((html: string, _profile: unknown, opts?: { recolor?: boolean }) => `SEEDED:${String(opts?.recolor)}:${html}`);
    mocks.profileMeta.mockReturnValue({});
    mocks.ensurePageMeta.mockImplementation((html: string) => `META:${html}`);
    mocks.sanitizeForPublish.mockImplementation((html: string) => ({ html: `SAFE:${html}`, errors: [], removed: {} }));
    mocks.adaptTemplateSkeleton.mockResolvedValue(ADAPTED);
    mocks.reserveVisualEnginePilotRun.mockResolvedValue({ ok: true, id: "pilot-1", ordinal: 1 });
    mocks.completeVisualEnginePilotRun.mockResolvedValue(undefined);
    mocks.listSections.mockResolvedValue([]);
    mocks.composeSectionCandidate.mockResolvedValue({
      ok: true,
      status: "composed",
      html: "COMPOSED:COMPLETE",
      creativeDirection: DIRECTION,
      manifest: {
        schemaVersion: "section-composition-manifest/1.0",
        intentHash: `sha256:${"a".repeat(64)}`,
        creativeDirectionHash: `sha256:${"b".repeat(64)}`,
        inventoryHash: `sha256:${"c".repeat(64)}`,
        orderedRoles: ["gallery"],
        selectedSectionIds: ["gallery-01"],
        selectedContentHashes: ["111111111111"],
        compatibilityRuleIds: ["section_component:exact:gallery"],
        outputHash: `sha256:${"d".repeat(64)}`,
        resultCode: "composed",
      },
      fill: { filled: true, appliedOps: 4, durationMs: 10, leaksBefore: 0, leaksAfter: 0 },
      adaptation: {
        ok: true, status: "adapted", creativeDirectionVersion: "creative-direction/1.0",
        planVersion: "skeleton-adaptation-plan/1.0", promptVersion: "creative-direction/1.7",
        modelId: "creative-model", structuralFingerprintBefore: `sha256:${"e".repeat(64)}`,
        structuralFingerprintAfter: `sha256:${"e".repeat(64)}`,
        usage: { inputTokens: 20, outputTokens: 10, thinkingTokens: 0, cachedTokens: 0 }, durationMs: 25,
      },
    });
    mocks.runQuickVisualRepair.mockImplementation(async (value) => value);
    mocks.launchShadowVisualRepair.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.createVersion.mockResolvedValue(undefined);
    mocks.renderProjectThumbnail.mockResolvedValue(undefined);
    mocks.creditsForUsage.mockReturnValue(3);
    mocks.debitCredits.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (previousVisualEngineMode === undefined) delete process.env.OPENLEN_VISUAL_ENGINE;
    else process.env.OPENLEN_VISUAL_ENGINE = previousVisualEngineMode;
    if (previousAssetMode === undefined) delete process.env.OPENLEN_VISUAL_ENGINE_ASSETS;
    else process.env.OPENLEN_VISUAL_ENGINE_ASSETS = previousAssetMode;
  });

  it("keeps off byte/event/persistence/debit behavior and calls no safe or creative path", async () => {
    const { events } = await post();
    const finalHtml = "SAFE:META:SEEDED:true:NORMAL:FILLED:RAW:weighted";

    expect(progress(events)).toEqual(["picking", "loading", "filling", "persisting"]);
    expect(previews(events)).toEqual(["RAW:weighted", finalHtml]);
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { title: "Mundo Color", templateId: "weighted", filled: true, appliedOps: 2, credits: 5 },
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ data: { html: finalHtml } }));
    expect(mocks.debitCredits).toHaveBeenCalledOnce();
    expect(mocks.debitCredits).toHaveBeenCalledWith("user-1", 5);
    expect(mocks.resolveProfileForCreation).toHaveBeenCalledOnce();
    expect(mocks.overlayProfile).toHaveBeenCalledOnce();
    expect(mocks.selectGenerationRoute).not.toHaveBeenCalled();
    expect(mocks.adaptTemplateSkeleton).not.toHaveBeenCalled();
    expect(mocks.reserveVisualEnginePilotRun).not.toHaveBeenCalled();
  });

  it("emits exactly one accepted skeleton preview and persists matching metadata", async () => {
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    const { events } = await post();
    const finalHtml = "SAFE:META:SEEDED:false:ADAPTED:NORMAL:FILLED:RAW:safe-skeleton";

    expect(previews(events)).toEqual([finalHtml]);
    expect(previews(events)).not.toContain("RAW:safe-skeleton");
    expect(previews(events)).not.toContain("NORMAL:FILLED:RAW:safe-skeleton");
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        html: finalHtml,
        generation: {
          visualEngine: expect.objectContaining({
            schemaVersion: "visual-engine-project/1.0",
            route: "template_skeleton",
            templateId: "safe-skeleton",
            creativeDirection: DIRECTION,
            promptVersion: "creative-prompt/1.0",
            policyVersion: "template-policy/1.0",
          }),
        },
      },
    }));
    expect(events.at(-1)).toMatchObject({ event: "done", data: { templateId: "safe-skeleton", credits: 5 } });
    expect(mocks.debitCredits).toHaveBeenCalledWith("user-1", 5);
    expect(mocks.resolveProfileForCreation).toHaveBeenCalledOnce();
    expect(mocks.overlayProfile).toHaveBeenCalledOnce();
    const persisted = mocks.insertValues.mock.calls[0]![0] as { id: string };
    expect(mocks.adaptTemplateSkeleton).toHaveBeenCalledWith(expect.objectContaining({
      assetContext: { mode: "off", projectId: persisted.id },
    }), { onAssetTrace: expect.any(Function) });
  });

  it.each([
    ["success", SHADOW_TRACE],
    ["typed failure", SHADOW_FAILURE_TRACE],
  ] as const)("sends only the parsed asset shadow trace to the production log sink on %s", async (_name, trace) => {
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    process.env.OPENLEN_VISUAL_ENGINE_ASSETS = "shadow";
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.adaptTemplateSkeleton.mockImplementation(async (_input, deps) => {
      deps?.onAssetTrace?.(trace);
      return ADAPTED;
    });
    await post();
    expect(log).toHaveBeenCalledWith("[curate] asset shadow trace", trace);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/html|prompt(?!Sha256)|dataBase64|manifestId.*slots/i);
    log.mockRestore();
  });

  it("emits and persists only the original weighted fallback after skeleton failure", async () => {
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    mocks.adaptTemplateSkeleton.mockResolvedValue({
      ok: false,
      status: "fallback",
      reasonCode: "contrast_violation",
      promptVersion: "creative-prompt/1.0",
      modelId: "creative-model",
      usage: null,
      durationMs: 25,
    });
    const { events } = await post();
    const fallbackHtml = "SAFE:META:SEEDED:true:NORMAL:FILLED:RAW:weighted";

    expect(previews(events)).toEqual([fallbackHtml]);
    expect(previews(events).join(" ")).not.toContain("safe-skeleton");
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ data: { html: fallbackHtml } }));
    expect(events.at(-1)).toMatchObject({ event: "done", data: { templateId: "weighted", credits: 5 } });
    expect(mocks.debitCredits).toHaveBeenCalledOnce();
  });

  it("delivers one finalized composition preview with section metadata and unchanged credits", async () => {
    process.env.OPENLEN_VISUAL_ENGINE = "composition";
    mocks.selectGenerationRoute.mockResolvedValue(SAFE_COMPOSITION);
    const { events } = await post();
    const finalHtml = "SAFE:META:SEEDED:false:COMPOSED:COMPLETE";

    expect(previews(events)).toEqual([finalHtml]);
    expect(previews(events).join(" ")).not.toContain("RAW:");
    expect(mocks.listSections).toHaveBeenCalledWith({ status: "published" });
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        html: finalHtml,
        generation: {
          visualEngine: expect.objectContaining({
            route: "section_composition",
            templateId: null,
            creativeDirection: DIRECTION,
            compositionManifest: expect.objectContaining({ resultCode: "composed" }),
          }),
        },
      },
    }));
    expect(events.at(-1)).toMatchObject({ event: "done", data: { templateId: "section-composition", credits: 5 } });
    expect(mocks.debitCredits).toHaveBeenCalledWith("user-1", 5);
  });

  it("repair on emits and persists only the accepted final document", async () => {
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    mocks.visualRepairMode.mockReturnValue("on");
    mocks.runQuickVisualRepair.mockImplementation(async (value) => ({
      html: "REPAIRED:FINAL",
      visualEngine: { ...value.visualEngine, repair: { schemaVersion: "visual-repair-metadata/1.0", accepted: true } },
    }));
    const { events } = await post();
    expect(progress(events)).toEqual(expect.arrayContaining(["reviewing", "polishing", "persisting"]));
    expect(previews(events)).toEqual(["REPAIRED:FINAL"]);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ html: "REPAIRED:FINAL", generation: { visualEngine: expect.objectContaining({ repair: expect.objectContaining({ accepted: true }) }) } }) }));
    expect(mocks.runQuickVisualRepair).toHaveBeenCalledTimes(1);
    const persisted = mocks.insertValues.mock.calls[0]![0] as { id: string };
    expect(mocks.runQuickVisualRepair).toHaveBeenCalledWith(expect.objectContaining({
      projectId: persisted.id,
      assetMode: "off",
      assetTraceSink: expect.any(Function),
    }), { mode: "on" });
  });

  it("repair shadow is detached and cannot change preview or persistence", async () => {
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    mocks.visualRepairMode.mockReturnValue("shadow");
    let resolveRepair!: () => void;
    mocks.launchShadowVisualRepair.mockImplementation(() => new Promise<void>((resolve) => { resolveRepair = resolve; }));
    const { events } = await post();
    const original = "SAFE:META:SEEDED:false:ADAPTED:NORMAL:FILLED:RAW:safe-skeleton";
    expect(previews(events)).toEqual([original]);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ html: original }) }));
    expect(mocks.launchShadowVisualRepair).toHaveBeenCalledTimes(1);
    resolveRepair();
  });

  it("delivers baseline without awaiting shadow, then reserves and completes only the background candidate", async () => {
    process.env.OPENLEN_VISUAL_ENGINE = "shadow";
    let resolveSafe!: (value: typeof SAFE_SKELETON) => void;
    mocks.selectGenerationRoute.mockImplementation(() => new Promise((resolve) => { resolveSafe = resolve; }));

    const response = await POST(new Request("http://localhost/api/curate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "Una plataforma infantil para colorear y crear" }),
    }));
    const body = await Promise.race([
      response.text(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 250)),
    ]);
    expect(body).not.toBe("timeout");
    const events = parseSse(body as string);
    const baselineHtml = "SAFE:META:SEEDED:true:NORMAL:FILLED:RAW:weighted";

    expect(previews(events)).toEqual(["RAW:weighted", baselineHtml]);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ data: { html: baselineHtml } }));
    expect(mocks.reserveVisualEnginePilotRun).not.toHaveBeenCalled();

    resolveSafe(SAFE_SKELETON);
    await vi.waitFor(() => expect(mocks.completeVisualEnginePilotRun).toHaveBeenCalledOnce());
    expect(mocks.reserveVisualEnginePilotRun).toHaveBeenCalledWith(expect.objectContaining({
      phase: "2a", mode: "shadow", route: "template_skeleton", templateId: "safe-skeleton",
    }));
    expect(mocks.completeVisualEnginePilotRun).toHaveBeenCalledWith("pilot-1", expect.objectContaining({
      status: "adapted", candidatePersisted: false,
    }));
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.debitCredits).toHaveBeenCalledOnce();
    expect(mocks.debitCredits).toHaveBeenCalledWith("user-1", 5);
    expect(mocks.resolveProfileForCreation).toHaveBeenCalledOnce();
    expect(mocks.overlayProfile).toHaveBeenCalledOnce();
    expect(mocks.runShadowSelection).not.toHaveBeenCalled();
  });
});
