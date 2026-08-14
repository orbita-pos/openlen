import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "@/lib/generation/content-hash";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  captureException: vi.fn(),
  getCreditState: vi.fn(),
  debitCredits: vi.fn(),
  commitAtomic: vi.fn(),
  creditsForUsage: vi.fn(),
  consumeToken: vi.fn(),
  createVersion: vi.fn(),
  renderProjectThumbnail: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  remove: vi.fn(),
  removeWhere: vi.fn(),
  resolveProfileForCreation: vi.fn(),
  runAiCreation: vi.fn(),
  failTelemetry: vi.fn(),
  finalizeTelemetry: vi.fn(),
}));

vi.mock("@inariwatch/capture", () => ({ captureException: mocks.captureException }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { insert: mocks.insert, delete: mocks.remove },
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
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfileForCreation }));
vi.mock("@/lib/curate/run-ai-creation", () => ({ runAiCreation: mocks.runAiCreation }));
vi.mock("@/lib/curate/atomic-curate-commit", () => ({ commitCurateProjectAndDebit: mocks.commitAtomic }));

import { POST } from "@/app/api/curate/route";

const BRIEF = "Una plataforma infantil para colorear y crear";
const FINAL_HTML = "FINAL-HYBRID-HTML";
const FINAL_HASH = sha256(FINAL_HTML);
const VISUAL_ENGINE = {
  schemaVersion: "visual-engine-project/1.0",
  route: "section_composition",
  templateId: null,
  policyVersion: "ai-hybrid-policy/1.0",
  compositionManifest: {
    resultCode: "composed",
    outputHash: FINAL_HASH,
  },
};
const SUCCESS = {
  ok: true,
  route: "section_composition",
  templateId: null,
  title: "Mundo Color",
  html: FINAL_HTML,
  visualEngine: VISUAL_ENGINE,
  copyUsage: { inputTokens: 120, outputTokens: 30 },
  filled: true,
  appliedOps: 4,
  failFableTelemetry: mocks.failTelemetry,
  finalizeFableTelemetry: mocks.finalizeTelemetry,
};

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  return text.trim().split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    return {
      event: lines[0]!.slice("event: ".length),
      data: JSON.parse(lines[1]!.slice("data: ".length)) as Record<string, unknown>,
    };
  });
}

async function request(body: unknown = { brief: BRIEF }): Promise<Response> {
  return POST(new Request("http://localhost/api/curate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function post(body?: unknown): Promise<{ response: Response; events: SseEvent[]; text: string }> {
  const response = await request(body);
  const text = await response.text();
  return { response, text, events: parseSse(text) };
}

function eventsNamed(events: SseEvent[], name: string): SseEvent[] {
  return events.filter((event) => event.event === name);
}

const previousAiCreation = process.env.OPENLEN_AI_CREATION;
const previousAssetMode = process.env.OPENLEN_VISUAL_ENGINE_ASSETS;

describe("POST /api/curate hybrid-only integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENLEN_AI_CREATION = "enabled";
    process.env.OPENLEN_VISUAL_ENGINE_ASSETS = "off";
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.consumeToken.mockReturnValue({ allowed: true });
    mocks.getCreditState.mockResolvedValue({ balance: 10 });
    mocks.resolveProfileForCreation.mockResolvedValue({
      id: "profile-1",
      data: { brand: { accent: "#EC4899", logoUrl: null } },
    });
    mocks.runAiCreation.mockImplementation(async (input: { onStage?: (stage: string) => void }) => {
      for (const stage of ["intent", "copy", "sections", "composition", "delivery_gate", "visual_quality"]) {
        input.onStage?.(stage);
      }
      return SUCCESS;
    });
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.remove.mockReturnValue({ where: mocks.removeWhere });
    mocks.removeWhere.mockResolvedValue(undefined);
    mocks.createVersion.mockResolvedValue(undefined);
    mocks.renderProjectThumbnail.mockResolvedValue(undefined);
    mocks.creditsForUsage.mockReturnValue(3);
    mocks.debitCredits.mockResolvedValue(undefined);
    mocks.commitAtomic.mockResolvedValue(undefined);
    mocks.failTelemetry.mockResolvedValue(undefined);
    mocks.finalizeTelemetry.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (previousAiCreation === undefined) delete process.env.OPENLEN_AI_CREATION;
    else process.env.OPENLEN_AI_CREATION = previousAiCreation;
    if (previousAssetMode === undefined) delete process.env.OPENLEN_VISUAL_ENGINE_ASSETS;
    else process.env.OPENLEN_VISUAL_ENGINE_ASSETS = previousAssetMode;
  });

  it("fails closed when AI creation is disabled and reaches no delivery side effect", async () => {
    process.env.OPENLEN_AI_CREATION = "disabled";

    const { events } = await post();

    expect(eventsNamed(events, "error")).toEqual([{
      event: "error",
      data: {
        kind: "creation_disabled",
        message: "No pudimos construir una página coherente. Reintentar.",
      },
    }]);
    expect(mocks.getCreditState).toHaveBeenCalledWith("user-1");
    expect(mocks.resolveProfileForCreation).not.toHaveBeenCalled();
    expect(mocks.runAiCreation).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(eventsNamed(events, "preview")).toEqual([]);
    expect(eventsNamed(events, "done")).toEqual([]);
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it("persists one final composition, then previews, debits, and completes with null template metadata", async () => {
    const { events } = await post({ brief: BRIEF, profileId: "profile-requested" });

    expect(mocks.resolveProfileForCreation).toHaveBeenCalledWith("user-1", "profile-requested");
    expect(mocks.runAiCreation).toHaveBeenCalledWith(expect.objectContaining({
      brief: BRIEF,
      profileData: { brand: { accent: "#EC4899", logoUrl: null } },
      assetMode: "off",
      onStage: expect.any(Function),
    }));
    expect(mocks.commitAtomic).toHaveBeenCalledTimes(1);
    expect(mocks.commitAtomic).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      credits: 5,
      title: "Mundo Color",
      brief: BRIEF,
      profileId: "profile-1",
      data: {
        html: FINAL_HTML,
        generation: {
          visualEngine: expect.objectContaining({
            route: "section_composition",
            templateId: null,
            compositionManifest: expect.objectContaining({
              resultCode: "composed",
              outputHash: FINAL_HASH,
            }),
          }),
        },
      },
    }));
    expect(eventsNamed(events, "preview")).toEqual([
      { event: "preview", data: { html: FINAL_HTML } },
    ]);
    expect(eventsNamed(events, "progress").map((event) => event.data.stage)).toEqual([
      "analyzing",
      "writing",
      "planning",
      "assembling",
      "styling",
      "reviewing",
      "persisting",
    ]);
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: {
        projectId: expect.any(String),
        title: "Mundo Color",
        route: "section_composition",
        templateId: null,
        filled: true,
        appliedOps: 4,
        credits: 5,
      },
    });
    expect(mocks.creditsForUsage).toHaveBeenCalledWith(120, 30, "gemini-flash");
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(mocks.createVersion).toHaveBeenCalledWith(expect.objectContaining({ html: FINAL_HTML }));
    expect(mocks.renderProjectThumbnail).toHaveBeenCalledWith(expect.objectContaining({ html: FINAL_HTML }));
    expect(mocks.finalizeTelemetry).toHaveBeenCalledOnce();
    expect(mocks.failTelemetry).not.toHaveBeenCalled();
  });

  it("uses the one-credit copy fallback without charging autofill when fill made no change", async () => {
    mocks.runAiCreation.mockResolvedValue({
      ...SUCCESS,
      copyUsage: undefined,
      filled: false,
    });

    const { events } = await post();

    expect(mocks.creditsForUsage).not.toHaveBeenCalled();
    expect(mocks.commitAtomic).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", credits: 1 }));
    expect(events.at(-1)).toMatchObject({ event: "done", data: { credits: 1, filled: false } });
  });

  it.each([
    ["intent", "intent_analysis_failed"],
    ["copy", "copy_generation_failed"],
    ["sections", "section_inventory_unavailable"],
    ["composition", "section_plan_failed"],
    ["composition", "section_fragment_unavailable"],
    ["composition", "composition_failed"],
    ["delivery_gate", "inherited_copy_leak"],
    ["composition", "creative_direction_failed"],
    ["composition", "asset_resolution_failed"],
    ["delivery_gate", "semantic_gate_failed"],
    ["visual_quality", "visual_quality_failed"],
  ] as const)("fails closed for %s/%s", async (stage, reasonCode) => {
    mocks.runAiCreation.mockResolvedValue({
      ok: false,
      stage,
      reasonCode,
      retryable: true,
      message: "RAW PROVIDER FAILURE secret-html",
    });

    const { events, text } = await post();

    expect(eventsNamed(events, "error")).toEqual([{
      event: "error",
      data: {
        kind: reasonCode,
        message: "No pudimos construir una página coherente. Reintentar.",
      },
    }]);
    expect(text).not.toMatch(/RAW PROVIDER FAILURE|secret-html/);
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      route: "curate",
      stage,
      reasonCode,
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(eventsNamed(events, "preview")).toEqual([]);
    expect(eventsNamed(events, "done")).toEqual([]);
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it("maps a database failure to persistence_failed without preview, debit, done, or raw error leakage", async () => {
    mocks.commitAtomic.mockRejectedValue(new Error("private database address"));

    const { events, text } = await post();

    expect(mocks.commitAtomic).toHaveBeenCalledTimes(1);
    expect(eventsNamed(events, "error")).toEqual([{
      event: "error",
      data: {
        kind: "persistence_failed",
        message: "No pudimos construir una página coherente. Reintentar.",
      },
    }]);
    expect(text).not.toContain("private database address");
    expect(mocks.failTelemetry).toHaveBeenCalledWith("delivery", "persistence_failed");
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      route: "curate",
      stage: "persistence",
      reasonCode: "persistence_failed",
    });
    expect(eventsNamed(events, "preview")).toEqual([]);
    expect(eventsNamed(events, "done")).toEqual([]);
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it("leaves observable project and debit state unchanged when the atomic debit is rejected", async () => {
    const state = { projects: [] as string[], debited: 0 };
    mocks.commitAtomic.mockImplementation(async () => { throw new Error("private debit failure"); });

    const { events, text } = await post();

    expect(mocks.commitAtomic).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ projects: [], debited: 0 });
    expect(eventsNamed(events, "preview")).toEqual([]);
    expect(eventsNamed(events, "done")).toEqual([]);
    expect(eventsNamed(events, "error")).toEqual([{
      event: "error",
      data: { kind: "persistence_failed", message: expect.any(String) },
    }]);
    expect(text).not.toContain("private debit failure");
    expect(mocks.failTelemetry).toHaveBeenCalledWith("delivery", "persistence_failed");
  });

  it("leaves observable state unchanged on atomic insert failure and on later credit/validation exceptions", async () => {
    const state = { projects: [] as string[], debited: 0 };
    mocks.commitAtomic.mockImplementationOnce(async () => { throw new Error("private insert failure"); });
    let outcome = await post();
    expect(outcome.events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(state).toEqual({ projects: [], debited: 0 });
    expect(mocks.failTelemetry).toHaveBeenCalledWith("delivery", "persistence_failed");

    mocks.failTelemetry.mockClear();
    mocks.creditsForUsage.mockImplementationOnce(() => { throw new Error("private calculation failure"); });
    outcome = await post();
    expect(mocks.commitAtomic).toHaveBeenCalledTimes(1);
    expect(outcome.events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(state).toEqual({ projects: [], debited: 0 });
    expect(mocks.failTelemetry).toHaveBeenCalledWith("delivery", "persistence_failed");

    mocks.failTelemetry.mockClear();
    mocks.runAiCreation.mockResolvedValueOnce({ ...SUCCESS, visualEngine: { ...VISUAL_ENGINE, templateId: "forged" } });
    outcome = await post();
    expect(mocks.commitAtomic).toHaveBeenCalledTimes(1);
    expect(outcome.events.filter((event) => ["preview", "done"].includes(event.event))).toEqual([]);
    expect(state).toEqual({ projects: [], debited: 0 });
    expect(mocks.failTelemetry).toHaveBeenCalledWith("delivery", "persistence_failed");
  });

  it("preserves authentication, rate, input, and credit prechecks before the pipeline", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);

    mocks.consumeToken.mockReturnValueOnce({ allowed: false, retryAfterMs: 60_000, limit: 10 });
    expect((await request()).status).toBe(429);

    expect((await request({ brief: "short" })).status).toBe(400);

    mocks.getCreditState.mockResolvedValueOnce({ balance: 0 });
    const { events } = await post();
    expect(eventsNamed(events, "error")).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ kind: "credits" }) }),
    ]);
    expect(mocks.runAiCreation).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });
});
