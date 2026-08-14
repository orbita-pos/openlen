import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import type { SectionRecord } from "@/lib/sections/store";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), captureException: vi.fn(), getCreditState: vi.fn(), debitCredits: vi.fn(), creditsForUsage: vi.fn(), consumeToken: vi.fn(),
  createVersion: vi.fn(), renderProjectThumbnail: vi.fn(), insert: vi.fn(), insertValues: vi.fn(), remove: vi.fn(), removeWhere: vi.fn(), resolveProfileForCreation: vi.fn(), commitAtomic: vi.fn(),
}));

vi.mock("@inariwatch/capture", () => ({ captureException: mocks.captureException }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert, delete: mocks.remove }, schema: { projects: { id: "projects" } } }));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({ getCreditState: mocks.getCreditState, debitCredits: mocks.debitCredits, creditsForUsage: mocks.creditsForUsage, AUTOFILL_CREDIT_COST: 2 }));
vi.mock("@/lib/rate-limit", () => ({ consumeToken: mocks.consumeToken, RATE_LIMITS: { autofill: { capacity: 10, refillPerSecond: 1 } } }));
vi.mock("@/lib/projects/thumbnail", () => ({ renderProjectThumbnail: mocks.renderProjectThumbnail }));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfileForCreation }));
vi.mock("@/lib/curate/atomic-curate-commit", () => ({ commitCurateProjectAndDebit: mocks.commitAtomic }));

import { createCuratePost } from "@/lib/curate/curate-post-handler";

const BRIEF = "Una plataforma infantil para colorear, jugar y crear historias";
const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";
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
      children: [
        { kind: "copy", id: `copy-${ordinal}`, variant: "heading", copyKey: "business_name", tone: "strong", size: ordinal === 0 ? "display" : "2xl", color: "ink", align: "start" },
        ...(ordinal === 0 ? [{ kind: "media", id: "hero-art", slotIndex: 0, aspect: "cinematic", fit: "cover", treatment: "framed", radius: "lg", transform: "none" }] : []),
      ],
    },
    responsive: { mobile: [{ nodeId: `root-${ordinal}`, preset: "stack", columns: "one", gap: "sm", padding: "sm", hidden: false }] },
    motion: [{ nodeId: `copy-${ordinal}`, preset: ordinal === 0 ? "reveal" : "fade_up", intensity: "medium", delay: "short" }],
  };
}

function fireworksBoundary(options: {
  final: "accept" | "reject" | "repair" | "paid_failure";
  calls: string[];
  qwenImagePayloads: string[][];
}): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; user: string; messages: Array<{ role: string; content: unknown }> };
      options.calls.push(`${body.model}:${body.user}`);
      const user = body.messages.findLast((message) => message.role === "user")?.content;
      const parsedUser = typeof user === "string" ? JSON.parse(user) as Record<string, any> : {};
      let response: unknown;
      if (body.user.endsWith(".intent")) {
        response = {
          schemaVersion: "intent-analysis/1.0", language: "es",
          functional: { siteType: "content_platform", requiredSections: ["hero", "features", "footer"], primaryActions: ["create"], contentModel: "creative_play" },
          audience: { primary: "children", ageRange: null, secondary: ["parents"] }, domains: ["creative_play"], emotionalGoals: ["playful"],
          requiredVisualSignals: ["hand_drawn"], forbiddenVisualSignals: ["saas_dashboard"], explicitConstraints: [], ambiguities: [], confidence: .95,
        };
      } else if (body.user.endsWith(".copy")) {
        response = { schemaVersion: "page-copy/1.0", copy: { business_name: "Mundo Pincel", pitch: "Crea mundos llenos de color", features: [] } };
      } else if (body.user.endsWith(".scout")) {
        response = { schemaVersion: "adaptive-candidate-decisions/1.0", decisions: ["hero", "features", "footer"].map((_role, ordinal) => ({ ordinal, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: [] })) };
      } else if (body.user.endsWith(".plan")) {
        const payload = parsedUser;
        const requiredSignals = [...new Set([...payload.initialDirection.requiredVisualSignals, ...payload.intent.requiredSignals])].sort();
        const forbiddenSignals = [...new Set([...payload.initialDirection.forbiddenVisualSignals, ...payload.intent.forbiddenSignals])].sort();
        response = {
          schemaVersion: "adaptive-page-design/1.0", narrative: payload.requiredRoles,
          direction: { ...payload.initialDirection, requiredVisualSignals: requiredSignals, forbiddenVisualSignals: forbiddenSignals }, decisions: payload.scoutDecisions,
          rhythm: "playful", requiredSignals, forbiddenSignals,
          imageSlots: [{ slotIndex: 0, ordinal: 0, required: true, mediaType: "illustration", subject: "friendly_animals", purpose: "hero_focal" }],
        };
      } else if (/\.section-\d+$/.test(body.user)) {
        const ordinal = Number(parsedUser.ordinal);
        response = expressiveProgram(parsedUser.role, ordinal);
      } else if (body.user.endsWith(".repair")) {
        const target = parsedUser.programs[0];
        response = { schemaVersion: "glm-visual-repair-delta/1.0", changes: [{ programId: target.programId, program: { ...target.program, root: { ...target.program.root, gap: "2xl" } } }] };
      } else {
        const imagePayloads = body.messages.flatMap((message) => Array.isArray(message.content)
          ? message.content.flatMap((part: any) => part?.type === "image_url" ? [String(part.image_url.url)] : [])
          : []);
        options.qwenImagePayloads.push(imagePayloads);
        const initial = body.user.endsWith(".initial.final");
        if (initial && options.final === "paid_failure") {
          return new Response(JSON.stringify({
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 2 } },
          }), { status: 400, headers: { "content-type": "application/json" } });
        }
        const decision = initial ? options.final : "accept";
        response = {
          schemaVersion: "fable-visual-verdict/1.0", nicheRecognition: 9, promptFidelity: 9, visualQuality: 9, coherence: 9, originality: 9, mobileQuality: 9,
          wrongNiche: false, genericAiStyle: false,
          issues: decision === "repair" ? [{ code: "originality", severity: "major", viewport: "desktop" }] : [], decision,
        };
      }
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 2 } },
      }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function realPost(options: { final?: "accept" | "reject" | "repair" | "paid_failure"; sequence: string[]; calls: string[]; defaultTelemetry?: boolean }) {
  const qwenImagePayloads: string[][] = [];
  const renderedDocuments: string[] = [];
  const fireworksFetch = vi.fn(fireworksBoundary({ final: options.final ?? "accept", calls: options.calls, qwenImagePayloads }));
  const geminiFetch = vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: JPEG } }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 2, cachedContentTokenCount: 0, thoughtsTokenCount: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  const telemetrySink = vi.fn(async (event) => { options.sequence.push(`telemetry:${event.outcome}`); });
  const renderViewports = vi.fn(async (html: string) => {
    renderedDocuments.push(html);
    return { desktop: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobile: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false };
  });
  const storage = {
    put: vi.fn(async (_projectId: string, bytes: Buffer, ext: string, contentType: string) => ({ filename: `${createHash("sha256").update(bytes).digest("hex")}.${ext}`, contentType, size: bytes.length, url: "https://ignored.invalid/generated.jpg" })),
    get: vi.fn(async () => null), list: vi.fn(async () => []), listAudio: vi.fn(async () => []),
  };
  return {
    telemetrySink, fireworksFetch, geminiFetch, qwenImagePayloads, renderedDocuments, renderViewports,
    post: createCuratePost({
      runAiCreationDeps: {
        listSections: vi.fn(async () => [RECORD]),
        fableRuntimeOptions: {
          budgetConfig: { rateCardVersion: "test", mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 },
          fireworksClientOptions: { apiKey: "fixture-fireworks-key", fetchImpl: fireworksFetch as unknown as typeof fetch, now: () => 100 },
          geminiAssetPackProviderOptions: {
            apiKey: "fixture-gemini-key",
            fetchImpl: geminiFetch as unknown as typeof fetch,
            now: () => 100,
            env: {
              NODE_ENV: "test",
              OPENLEN_VISUAL_ENGINE_ASSET_RATE_CARD_VERSION: "7",
              OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN: "1000000",
              OPENLEN_VISUAL_ENGINE_ASSET_ESTIMATED_IMAGE_MICROMXN: "100000",
            },
          },
          renderViewports,
          ...(options.defaultTelemetry ? {} : { telemetrySink }),
        },
        fableAdaptivePipelineDeps: {
          fetchText: async (url) => url === "memory://hero-donor" ? DONOR : null,
          renderContactSheet: async () => ({ mimeType: "image/jpeg", dataBase64: JPEG }),
          renderViewports,
          assetResolutionDeps: {
            loadCuratedImages: async () => [],
            fetchImpl: vi.fn() as unknown as typeof fetch,
            storage: storage as never,
            budget: { version: "7", maxCostMicromxn: 1_000_000, estimatedImageCostMicromxn: 100_000 },
            catalogVersion: "test-images/1",
          },
        },
      },
    }),
  };
}

async function invoke(post: (request: Request) => Promise<Response>) {
  const response = await post(new Request("http://localhost/api/curate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: BRIEF }) }));
  return parseSse(await response.text());
}

const previous = Object.fromEntries(["OPENLEN_AI_CREATION", "OPENLEN_AI_CREATION_ROLLOUT_PERCENT", "OPENLEN_VISUAL_ENGINE_ASSETS", "OPENLEN_FABLE_RATE_CARD_VERSION", "OPENLEN_FABLE_MXN_PER_USD", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"].map((key) => [key, process.env[key]]));

describe("POST /api/curate real Fable root", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENLEN_AI_CREATION = "enabled";
    process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT = "99";
    process.env.OPENLEN_VISUAL_ENGINE_ASSETS = "hybrid";
    mocks.auth.mockResolvedValue({ user: { id: "fable-user" } }); mocks.consumeToken.mockReturnValue({ allowed: true }); mocks.getCreditState.mockResolvedValue({ balance: 10 });
    mocks.resolveProfileForCreation.mockResolvedValue({ id: "profile-1", data: { business_name: "Mundo Pincel", brand: { accent: "#EC4899", logoUrl: null } } });
    mocks.insert.mockReturnValue({ values: mocks.insertValues }); mocks.insertValues.mockResolvedValue(undefined); mocks.remove.mockReturnValue({ where: mocks.removeWhere }); mocks.removeWhere.mockResolvedValue(undefined);
    mocks.creditsForUsage.mockReturnValue(1); mocks.debitCredits.mockResolvedValue(undefined); mocks.createVersion.mockResolvedValue(undefined); mocks.renderProjectThumbnail.mockResolvedValue(undefined);
    mocks.commitAtomic.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  it.each(["accept", "repair"] as const)("runs the real adaptive POST through Qwen (%s), then commits exactly once", async (final) => {
    const sequence: string[] = [];
    mocks.commitAtomic.mockImplementation(async () => { sequence.push("project", "debit"); });
    const calls: string[] = [];
    const runtime = realPost({ final, sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls, JSON.stringify({ events, sequence, telemetry: runtime.telemetrySink.mock.calls })).toEqual(expect.arrayContaining([expect.stringMatching(/:.*\.scout$/), expect.stringMatching(/:.*\.initial\.final$/)]));
    expect(calls.filter((call) => call.endsWith(".repair"))).toHaveLength(final === "repair" ? 1 : 0);
    expect(calls.filter((call) => call.includes(".section-"))).toHaveLength(3);
    expect(mocks.commitAtomic).toHaveBeenCalledOnce();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(events.filter((event) => event.event === "preview")).toHaveLength(1);
    expect(events.filter((event) => event.event === "done")).toHaveLength(1);
    expect(events.filter((event) => event.event === "error")).toHaveLength(0);
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "delivered" }));
    expect(runtime.geminiFetch).toHaveBeenCalledTimes(1);
    expect(runtime.geminiFetch.mock.calls.length).toBeLessThanOrEqual(3);
    expect(runtime.qwenImagePayloads).toHaveLength(final === "repair" ? 2 : 1);
    for (const payloads of runtime.qwenImagePayloads) {
      expect(payloads).toEqual([`data:image/jpeg;base64,${JPEG}`, `data:image/jpeg;base64,${JPEG}`]);
      expect(payloads.map((payload) => Buffer.from(payload.split(",")[1]!, "base64").subarray(0, 2).toString("hex"))).toEqual(["ffd8", "ffd8"]);
      await expect(Promise.all(payloads.map(async (payload) => {
        const metadata = await sharp(Buffer.from(payload.split(",")[1]!, "base64")).metadata();
        return { format: metadata.format, width: metadata.width, height: metadata.height };
      }))).resolves.toEqual([
        { format: "jpeg", width: 64, height: 64 },
        { format: "jpeg", width: 64, height: 64 },
      ]);
    }
    expect(runtime.renderedDocuments.some((html) => html.includes("background-image:url('/api/projects/"))).toBe(true);
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "delivered",
      cost: expect.objectContaining({ modelUsage: expect.any(Array), imageUsage: [expect.objectContaining({ modelId: "gemini-2.5-flash-image", imageCount: 1 })] }),
    }));
    const deliveredTelemetry = runtime.telemetrySink.mock.calls
      .map(([event]) => event as { outcome?: string; paidCalls?: Array<{ kind: string; stage: string }> })
      .find((event) => event.outcome === "delivered");
    const paidOrder = deliveredTelemetry?.paidCalls?.map((call) => `${call.kind}:${call.stage}`) ?? [];
    expect(paidOrder.filter((call) => call === "model:initial_program")).toHaveLength(3);
    expect(paidOrder.findLastIndex((call) => call === "model:initial_program"))
      .toBeLessThan(paidOrder.indexOf("image:image"));
    expect(sequence).toEqual(["project", "debit", "telemetry:delivered"]);
  });

  it("records a paid Qwen rejection before returning zero preview/project/debit/done", async () => {
    const sequence: string[] = [];
    const calls: string[] = [];
    const runtime = realPost({ final: "reject", sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls, JSON.stringify({ events, sequence })).toEqual(expect.arrayContaining([expect.stringMatching(/:.*\.initial\.final$/)]));
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", stage: "visual_quality" }));
    expect(sequence).toEqual(["telemetry:failed"]);
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
  });

  it("flushes paid-provider failure telemetry before returning zero preview/project/debit/done", async () => {
    const sequence: string[] = [];
    const calls: string[] = [];
    const runtime = realPost({ final: "paid_failure", sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls).toEqual(expect.arrayContaining([expect.stringMatching(/:.*\.initial\.final$/)]));
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      stage: "visual_quality",
      paidCalls: expect.arrayContaining([expect.objectContaining({ kind: "model", stage: "final_critic" })]),
    }));
    expect(sequence).toEqual(["telemetry:failed"]);
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
  });

  it("retains delivered and paid-failure telemetry through the default route sink", async () => {
    const retained: Array<{ outcome: string; paidCalls: unknown[] }> = [];
    vi.spyOn(console, "info").mockImplementation((line) => { retained.push(JSON.parse(String(line))); });
    mocks.commitAtomic.mockResolvedValue(undefined);

    await invoke(realPost({ final: "accept", sequence: [], calls: [], defaultTelemetry: true }).post);
    await invoke(realPost({ final: "reject", sequence: [], calls: [], defaultTelemetry: true }).post);

    expect(retained.map((event) => event.outcome)).toEqual(["delivered", "failed"]);
    expect(retained[0]!.paidCalls.length).toBeGreaterThan(0);
    expect(retained[1]!.paidCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(retained)).not.toMatch(/"(?:userId|prompt|copy|html|screenshot|url|providerBody|credential|secret)"\s*:/i);
  });

  it("fails closed before providers when required Fable budget configuration is absent", async () => {
    for (const key of ["OPENLEN_FABLE_RATE_CARD_VERSION", "OPENLEN_FABLE_MXN_PER_USD", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"]) delete process.env[key];
    const post = createCuratePost({ runAiCreationDeps: { listSections: vi.fn(async () => [RECORD]) } });

    const events = await invoke(post);

    expect(events.filter((event) => event.event === "error")).toEqual([expect.objectContaining({ data: expect.objectContaining({ kind: "intent_analysis_failed" }) })]);
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it.each([undefined, "0", "100", "1.5", "garbage"])(
    "fails closed before runtime, provider, project, or debit when rollout percent is %s",
    async (rolloutPercent) => {
      if (rolloutPercent === undefined) delete process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT;
      else process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT = rolloutPercent;
      const runAiCreationDeps = { listSections: vi.fn(async () => [RECORD]) };
      const post = createCuratePost({ runAiCreationDeps });

      const events = await invoke(post);

      expect(events).toEqual([expect.objectContaining({ event: "error", data: expect.objectContaining({ kind: "creation_disabled" }) })]);
      expect(runAiCreationDeps.listSections).not.toHaveBeenCalled();
      expect(mocks.commitAtomic).not.toHaveBeenCalled();
      expect(mocks.debitCredits).not.toHaveBeenCalled();
    },
  );

  it("uses a stable SHA-256 cohort and fails outside it before provider or credit debit", async () => {
    process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT = "50";
    mocks.auth.mockResolvedValue({ user: { id: "outside-user" } });
    const runAiCreationDeps = { listSections: vi.fn(async () => [RECORD]) };
    const post = createCuratePost({ runAiCreationDeps });

    const first = await invoke(post);
    const second = await invoke(post);

    expect(first).toEqual([expect.objectContaining({ event: "error", data: expect.objectContaining({ kind: "creation_disabled" }) })]);
    expect(second).toEqual(first);
    expect(runAiCreationDeps.listSections).not.toHaveBeenCalled();
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });
});
