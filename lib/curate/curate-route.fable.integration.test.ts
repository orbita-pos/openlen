import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import type { FireworksJsonRequest } from "@/lib/ai/fireworks-contracts";
import { createFableRuntimeComposition } from "./fable-runtime-composition";
import { createPageGenerationBudget } from "@/lib/generation/page-generation-budget";
import type { SectionRecord } from "@/lib/sections/store";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), captureException: vi.fn(), getCreditState: vi.fn(), debitCredits: vi.fn(), creditsForUsage: vi.fn(), consumeToken: vi.fn(),
  createVersion: vi.fn(), renderProjectThumbnail: vi.fn(), insert: vi.fn(), insertValues: vi.fn(), remove: vi.fn(), removeWhere: vi.fn(), resolveProfileForCreation: vi.fn(),
}));

vi.mock("@inariwatch/capture", () => ({ captureException: mocks.captureException }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert, delete: mocks.remove }, schema: { projects: { id: "projects" } } }));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({ getCreditState: mocks.getCreditState, debitCredits: mocks.debitCredits, creditsForUsage: mocks.creditsForUsage, AUTOFILL_CREDIT_COST: 2 }));
vi.mock("@/lib/rate-limit", () => ({ consumeToken: mocks.consumeToken, RATE_LIMITS: { autofill: { capacity: 10, refillPerSecond: 1 } } }));
vi.mock("@/lib/projects/thumbnail", () => ({ renderProjectThumbnail: mocks.renderProjectThumbnail }));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfileForCreation }));

import { createCuratePost } from "@/lib/curate/curate-post-handler";

const BRIEF = "Una plataforma infantil para colorear, jugar y crear historias";
const JPEG = "aGVsbG8=";
const DONOR = '<header data-sec="hero-donor"><h1>Donor</h1></header>';
const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const RECORD = {
  id: "hero-donor", type: "hero", name: "Friendly hero", variantLabel: "Playful", rootTag: "header", mode: "light",
  storageKey: `sections/hero-donor-${shortHash(DONOR)}.html`, storageUrl: "memory://hero-donor", contentHash: shortHash(DONOR), size: DONOR.length,
  designTokens: null, fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null, provenance: null, derivedSemantics: null,
  status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
} as SectionRecord;

interface SseEvent { event: string; data: Record<string, unknown> }
function parseSse(text: string): SseEvent[] {
  return text.trim().split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    return { event: lines[0]!.slice(7), data: JSON.parse(lines[1]!.slice(6)) as Record<string, unknown> };
  });
}

function expressiveProgram(role: string, ordinal: number) {
  const presets = ["layered", "grid", "stack"] as const;
  const gaps = ["xl", "md", "sm"] as const;
  return {
    schemaVersion: "expressive-section-program/1.0", role,
    root: {
      kind: "layout", id: `root-${ordinal}`, preset: presets[ordinal], gap: gaps[ordinal], padding: "lg", width: "wide", align: "stretch", justify: "between",
      columns: ordinal === 1 ? "three" : "one", color: "surface", radius: ordinal === 2 ? "none" : "lg", border: "hairline", transform: "none", blend: "normal",
      children: [{ kind: "copy", id: `copy-${ordinal}`, variant: "heading", copyKey: "business_name", tone: "strong", size: ordinal === 0 ? "display" : "2xl", color: "ink", align: "start" }],
    },
    responsive: { mobile: [{ nodeId: `root-${ordinal}`, preset: "stack", columns: "one", gap: "sm", padding: "sm", hidden: false }] },
    motion: [{ nodeId: `copy-${ordinal}`, preset: ordinal === 0 ? "reveal" : "fade_up", intensity: "medium", delay: "short" }],
  };
}

function modelBoundary(options: { final: "accept" | "reject" | "repair" | "paid_failure"; calls: string[] }): FireworksJsonClient {
  return {
    async request<T>(request: FireworksJsonRequest<T>) {
      options.calls.push(`${request.role}:${request.requestId}`);
      const usage = { inputTokens: 5, cachedTokens: 0, outputTokens: 3, thinkingTokens: 1 };
      const user = request.messages.findLast((message) => message.role === "user")?.content;
      const parsedUser = typeof user === "string" ? JSON.parse(user) as Record<string, any> : {};
      let response: unknown;
      if (request.requestId.endsWith(".intent")) {
        response = {
          schemaVersion: "intent-analysis/1.0", language: "es",
          functional: { siteType: "coloring_pages", requiredSections: ["hero", "features", "footer"], primaryActions: ["create"], contentModel: "creative_play" },
          audience: { primary: "children", ageRange: null, secondary: ["parents"] }, domains: ["creative_play"], emotionalGoals: ["playful"],
          requiredVisualSignals: ["hand_drawn"], forbiddenVisualSignals: ["saas_dashboard"], explicitConstraints: [], ambiguities: [], confidence: .95,
        };
      } else if (request.requestId.endsWith(".copy")) {
        response = { schemaVersion: "page-copy/1.0", copy: { business_name: "Mundo Pincel", pitch: "Crea mundos llenos de color", features: [] } };
      } else if (request.requestId.endsWith(".scout")) {
        response = { schemaVersion: "adaptive-candidate-decisions/1.0", decisions: ["hero", "features", "footer"].map((_role, ordinal) => ({ ordinal, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: [] })) };
      } else if (request.requestId.endsWith(".plan")) {
        const payload = parsedUser;
        const requiredSignals = [...new Set([...payload.initialDirection.requiredVisualSignals, ...payload.intent.requiredSignals])].sort();
        const forbiddenSignals = [...new Set([...payload.initialDirection.forbiddenVisualSignals, ...payload.intent.forbiddenSignals])].sort();
        response = {
          schemaVersion: "adaptive-page-design/1.0", narrative: payload.requiredRoles,
          direction: { ...payload.initialDirection, requiredVisualSignals: requiredSignals, forbiddenVisualSignals: forbiddenSignals }, decisions: payload.scoutDecisions,
          rhythm: "playful", requiredSignals, forbiddenSignals, imageSlots: [],
        };
      } else if (/\.section-\d+$/.test(request.requestId)) {
        const ordinal = Number(parsedUser.ordinal);
        response = expressiveProgram(parsedUser.role, ordinal);
      } else if (request.requestId.endsWith(".repair")) {
        const target = parsedUser.programs[0];
        response = { schemaVersion: "glm-visual-repair-delta/1.0", changes: [{ programId: target.programId, program: { ...target.program, root: { ...target.program.root, gap: "2xl" } } }] };
      } else {
        const initial = request.requestId.endsWith(".initial.final");
        if (initial && options.final === "paid_failure") {
          return { ok: false as const, code: "provider" as const, modelId: `fixture-${request.role}`, usage, durationMs: 1, attempts: 1 as const };
        }
        const decision = initial ? options.final : "accept";
        response = {
          schemaVersion: "fable-visual-verdict/1.0", nicheRecognition: 9, promptFidelity: 9, visualQuality: 9, coherence: 9, originality: 9, mobileQuality: 9,
          wrongNiche: false, genericAiStyle: false,
          issues: decision === "repair" ? [{ code: "originality", severity: "major", viewport: "desktop" }] : [], decision,
        };
      }
      return { ok: true as const, value: request.responseSchema.parse(response), modelId: `fixture-${request.role}`, usage, durationMs: 1, attempts: 1 as const };
    },
  };
}

function realPost(options: { final?: "accept" | "reject" | "repair" | "paid_failure"; sequence: string[]; calls: string[] }) {
  const client = modelBoundary({ final: options.final ?? "accept", calls: options.calls });
  const telemetrySink = vi.fn(async (event) => { options.sequence.push(`telemetry:${event.outcome}`); });
  const budget = createPageGenerationBudget({ rateCardVersion: "test", mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 });
  return {
    telemetrySink,
    post: createCuratePost({
      runAiCreationDeps: {
        listSections: vi.fn(async () => [RECORD]),
        createFableRuntimeComposition: () => createFableRuntimeComposition({
          pageBudget: budget, client, telemetrySink,
          inspect: async () => ({ ok: true, deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false }, screenshots: { desktop: { mimeType: "image/jpeg", dataBase64: JPEG }, mobile: { mimeType: "image/jpeg", dataBase64: JPEG } } }),
        }),
        fableAdaptivePipelineDeps: {
          fetchText: async (url) => url === "memory://hero-donor" ? DONOR : null,
          renderContactSheet: async () => ({ mimeType: "image/jpeg", dataBase64: JPEG }),
          renderViewports: async () => ({ desktop: { mimeType: "image/jpeg", dataBase64: JPEG }, mobile: { mimeType: "image/jpeg", dataBase64: JPEG }, mobileOverflow: false, weakTypographyHierarchy: false }),
        },
      },
    }),
  };
}

async function invoke(post: (request: Request) => Promise<Response>) {
  const response = await post(new Request("http://localhost/api/curate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: BRIEF }) }));
  return parseSse(await response.text());
}

const previous = Object.fromEntries(["OPENLEN_AI_CREATION", "OPENLEN_VISUAL_ENGINE_ASSETS", "OPENLEN_FABLE_RATE_CARD_VERSION", "OPENLEN_FABLE_MXN_PER_USD", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"].map((key) => [key, process.env[key]]));

describe("POST /api/curate real Fable root", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENLEN_AI_CREATION = "enabled";
    process.env.OPENLEN_VISUAL_ENGINE_ASSETS = "off";
    mocks.auth.mockResolvedValue({ user: { id: "fable-user" } }); mocks.consumeToken.mockReturnValue({ allowed: true }); mocks.getCreditState.mockResolvedValue({ balance: 10 });
    mocks.resolveProfileForCreation.mockResolvedValue({ id: "profile-1", data: { business_name: "Mundo Pincel", brand: { accent: "#EC4899", logoUrl: null } } });
    mocks.insert.mockReturnValue({ values: mocks.insertValues }); mocks.insertValues.mockResolvedValue(undefined); mocks.remove.mockReturnValue({ where: mocks.removeWhere }); mocks.removeWhere.mockResolvedValue(undefined);
    mocks.creditsForUsage.mockReturnValue(1); mocks.debitCredits.mockResolvedValue(undefined); mocks.createVersion.mockResolvedValue(undefined); mocks.renderProjectThumbnail.mockResolvedValue(undefined);
  });

  afterAll(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  it.each(["accept", "repair"] as const)("runs the real adaptive POST through Qwen (%s), then commits exactly once", async (final) => {
    const sequence: string[] = [];
    mocks.insertValues.mockImplementation(async () => { sequence.push("project"); });
    mocks.debitCredits.mockImplementation(async () => { sequence.push("debit"); });
    const calls: string[] = [];
    const runtime = realPost({ final, sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls, JSON.stringify({ events, sequence, telemetry: runtime.telemetrySink.mock.calls })).toEqual(expect.arrayContaining([expect.stringMatching(/^visual_critic:.*\.scout$/), expect.stringMatching(/^visual_critic:.*\.initial\.final$/)]));
    expect(calls.filter((call) => call.endsWith(".repair"))).toHaveLength(final === "repair" ? 1 : 0);
    expect(calls.filter((call) => call.includes(".section-"))).toHaveLength(3);
    expect(mocks.insertValues).toHaveBeenCalledOnce();
    expect(mocks.debitCredits).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.event === "preview")).toHaveLength(1);
    expect(events.filter((event) => event.event === "done")).toHaveLength(1);
    expect(events.filter((event) => event.event === "error")).toHaveLength(0);
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "delivered" }));
    expect(sequence).toEqual(["project", "debit", "telemetry:delivered"]);
  });

  it("records a paid Qwen rejection before returning zero preview/project/debit/done", async () => {
    const sequence: string[] = [];
    const calls: string[] = [];
    const runtime = realPost({ final: "reject", sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls, JSON.stringify({ events, sequence })).toEqual(expect.arrayContaining([expect.stringMatching(/^visual_critic:.*\.initial\.final$/)]));
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", stage: "visual_quality" }));
    expect(sequence).toEqual(["telemetry:failed"]);
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
  });

  it("flushes paid-provider failure telemetry before returning zero preview/project/debit/done", async () => {
    const sequence: string[] = [];
    const calls: string[] = [];
    const runtime = realPost({ final: "paid_failure", sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls).toEqual(expect.arrayContaining([expect.stringMatching(/^visual_critic:.*\.initial\.final$/)]));
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      stage: "visual_quality",
      paidCalls: expect.arrayContaining([expect.objectContaining({ kind: "model", stage: "final_critic" })]),
    }));
    expect(sequence).toEqual(["telemetry:failed"]);
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
  });

  it("fails closed before providers when required Fable budget configuration is absent", async () => {
    for (const key of ["OPENLEN_FABLE_RATE_CARD_VERSION", "OPENLEN_FABLE_MXN_PER_USD", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"]) delete process.env[key];
    const post = createCuratePost({ runAiCreationDeps: { listSections: vi.fn(async () => [RECORD]) } });

    const events = await invoke(post);

    expect(events.filter((event) => event.event === "error")).toEqual([expect.objectContaining({ data: expect.objectContaining({ kind: "intent_analysis_failed" }) })]);
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });
});
