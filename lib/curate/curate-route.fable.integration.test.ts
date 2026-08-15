import { createHash } from "node:crypto";

import { createFireworksToolClient } from "@/lib/ai/fireworks-tool-client";
import { modelIdForRole } from "@/lib/generation/fable-model-policy";
import { createPageGenerationBudget } from "@/lib/generation/page-generation-budget";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import type { SectionRecord } from "@/lib/sections/store";
import type { RunAiCreationDeps } from "@/lib/curate/run-ai-creation";

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

const BRIEF = "Necesito un sitio para mi taller de restauración de relojes mecánicos";
const NICHE_BRIEF = "Una plataforma infantil para colorear, jugar y crear historias";
const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";
const DONOR = '<header data-sec="hero-donor"><h1>Donor</h1></header>';
const DEEPSEEK_MODEL = modelIdForRole("reasoner");
const CRITIC_MODEL = modelIdForRole("visual_critic");
const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const BODIES: Record<string, string> = {
  "header-fix": '<header data-sec="header-fix"><a href="#top">Donante marca</a><a href="#x">Donante enlace</a></header>',
  "hero-fix": '<header data-sec="hero-fix"><h1>Donante hero</h1><p>Texto donante</p><a href="#a">Acción</a></header>',
  "features-fix": '<section data-sec="features-fix"><h2>Donante features</h2><p>Uno</p><p>Dos</p><p>Tres</p></section>',
  "cta-fix": '<section data-sec="cta-fix"><h2>Donante cta</h2><a href="#c">Donante botón</a></section>',
  "footer-fix": '<footer data-sec="footer-fix"><p>Donante footer</p><a href="#b">Enlace</a></footer>',
};

function catalogRecord(id: string, type: string, rootTag: string, donorIndex: number) {
  const html = BODIES[id]!;
  const hash = shortHash(html);
  return {
    id, type, name: id, variantLabel: "Base", rootTag, mode: "light",
    storageKey: `sections/${id}-${hash}.html`, storageUrl: `memory://${id}`, contentHash: hash, size: html.length,
    designTokens: null, fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0",
      sourceTemplateId: `donor-${donorIndex}`,
      sourceTemplateHash: hash,
      sourceBandOrdinal: donorIndex,
      extractionVersion: "template-band-extractor/1.0",
      sourceHash: `sha256:${createHash("sha256").update(html).digest("hex")}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(`${id}-fp`).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0",
      role: type, layoutArchetypes: [], domains: [], audiences: [], moods: [], negativeSignals: [],
    },
    status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  } as unknown as SectionRecord;
}

const CATALOG = [
  catalogRecord("header-fix", "navbar", "header", 0),
  catalogRecord("hero-fix", "hero", "header", 1),
  catalogRecord("features-fix", "features", "section", 2),
  catalogRecord("cta-fix", "cta", "section", 3),
  catalogRecord("footer-fix", "footer", "footer", 4),
];

const CATALOG_FETCH = async (url: string) => BODIES[url.replace("memory://", "")] ?? null;

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

/** Tool-calling boundary. `mode` decides whether DeepSeek improves the page,
 * refuses to, or is unreachable entirely. */
function toolCall(name: string, args: unknown, reasoning: string) {
  return {
    role: "assistant", content: "", reasoning_content: reasoning,
    tool_calls: [{ index: 0, id: `call-${name}`, type: "function", name: null, function: { name, arguments: JSON.stringify(args) } }],
  };
}

/** The last target the sandbox reported back through `inspect_canvas`. The
 * model can only address handles OpenLen handed it. */
function lastInspectedTarget(messages: readonly { role: string; content: string }[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry?.role !== "tool") continue;
    try {
      const parsed = JSON.parse(entry.content) as { outline?: { targetId: string }[] };
      if (parsed.outline?.length) return parsed.outline[0]!.targetId;
    } catch { /* not an inspection result */ }
  }
  return null;
}

function toolBoundary(mode: "improve" | "finish" | "down" | "image", calls: string[], timeline: string[] = []): typeof fetch {
  let turn = 0;
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string; user: string; stream?: boolean; messages?: { role: string; content: string }[] };
    calls.push(`${body.model}:${body.user}`);
    timeline.push("provider");
    if (mode === "down") throw new Error("fireworks unreachable");
    const step = turn++;
    let message: unknown = { role: "assistant", content: "La página quedó bien.", reasoning_content: "listo" };
    if (mode === "improve" && step === 0) {
      message = toolCall("apply_creative_patch", { operations: [{ op: "set_page_css", css: ".ol-x{letter-spacing:.02em}" }] }, "mejorando el hero");
    } else if (mode === "image" && step === 0) {
      message = toolCall("inspect_canvas", {}, "quiero ver el lienzo");
    } else if (mode === "image" && step === 1) {
      const targetId = lastInspectedTarget(body.messages ?? []);
      message = targetId
        ? toolCall("request_image", { targetId, subject: "taller de relojes", mediaType: "photo" }, "una foto real")
        : { role: "assistant", content: "sin objetivos", reasoning_content: "nada" };
    }
    const patching = (message as { tool_calls?: unknown }).tool_calls !== undefined;
    const finishReason = patching ? "tool_calls" : "stop";
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 } };
    // The tool turns stream and the visual critic does not, and this one
    // boundary answers both.
    if (body.stream === true) {
      const frames = [
        { choices: [{ index: 0, delta: message, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
        { choices: [], usage },
      ];
      return new Response(
        `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response(JSON.stringify({
      choices: [{ finish_reason: finishReason, message }],
      usage,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function realPost(options: {
  mode?: "improve" | "finish" | "down" | "image";
  sequence: string[];
  calls: string[];
  defaultTelemetry?: boolean;
  resolveImage?: RunAiCreationDeps["resolveImage"];
}) {
  const renderedDocuments: string[] = [];
  const timeline: string[] = [];
  const fireworksFetch = vi.fn(toolBoundary(options.mode ?? "improve", options.calls, timeline));
  const telemetrySink = vi.fn(async (event) => { options.sequence.push(`telemetry:${event.outcome}`); });
  const renderViewports = vi.fn(async (html: string) => {
    renderedDocuments.push(html);
    timeline.push("render");
    return { desktop: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobile: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false };
  });
  const pageBudget = createPageGenerationBudget({ rateCardVersion: "test", mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 });
  const toolClient = createFireworksToolClient({ budget: pageBudget, apiKey: "fixture-fireworks-key", fetchImpl: fireworksFetch as unknown as typeof fetch, now: () => 100 });
  return {
    telemetrySink, fireworksFetch, renderedDocuments, renderViewports, timeline,
    post: createCuratePost({
      runAiCreationDeps: {
        listSections: vi.fn(async () => CATALOG),
        fetchText: CATALOG_FETCH,
        renderViewports: renderViewports as never,
        ...(options.resolveImage ? { resolveImage: options.resolveImage } : {}),
        fableRuntimeOptions: {
          pageBudget,
          toolClient,
          fireworksClientOptions: { apiKey: "fixture-fireworks-key", fetchImpl: fireworksFetch as unknown as typeof fetch, now: () => 100 },
          renderViewports,
          ...(options.defaultTelemetry ? {} : { telemetrySink }),
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

  it("commits exactly once when DeepSeek improves the page", async () => {
    const sequence: string[] = [];
    mocks.commitAtomic.mockImplementation(async () => { sequence.push("project", "debit"); });
    const calls: string[] = [];
    const runtime = realPost({ mode: "improve", sequence, calls });

    const events = await invoke(runtime.post);

    expect(calls.length, JSON.stringify({ events, telemetry: runtime.telemetrySink.mock.calls })).toBeGreaterThan(0);
    // DeepSeek writes the page; the vision critic reviews it. Both must be
    // reached, or a stage is silently dark.
    expect(calls.some((call) => call.startsWith(`${DEEPSEEK_MODEL}:`))).toBe(true);
    expect(calls.some((call) => call.startsWith(`${CRITIC_MODEL}:`))).toBe(true);
    expect(calls.every((call) => call.startsWith(`${DEEPSEEK_MODEL}:`) || call.startsWith(`${CRITIC_MODEL}:`))).toBe(true);
    expect(mocks.commitAtomic).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.event === "preview")).toHaveLength(1);
    expect(events.filter((event) => event.event === "done")).toHaveLength(1);
    expect(events.filter((event) => event.event === "error")).toHaveLength(0);
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "delivered" }));
    expect(sequence).toEqual(["project", "debit", "telemetry:delivered"]);
  });

  it.each(["down", "finish"] as const)("still delivers a page when DeepSeek is %s", async (mode) => {
    const sequence: string[] = [];
    mocks.commitAtomic.mockImplementation(async () => { sequence.push("project", "debit"); });
    const runtime = realPost({ mode, sequence, calls: [] });

    const events = await invoke(runtime.post);

    expect(events.filter((event) => event.event === "error"), JSON.stringify(events)).toHaveLength(0);
    expect(events.filter((event) => event.event === "preview")).toHaveLength(1);
    expect(events.filter((event) => event.event === "done")).toHaveLength(1);
    expect(mocks.commitAtomic).toHaveBeenCalledOnce();
    // Delivered, but the request still says out loud which stage was lost.
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "delivered",
      degradations: expect.arrayContaining([expect.objectContaining({ stage: "creative_session" })]),
    }));
    expect(sequence).toEqual(["project", "debit", "telemetry:delivered"]);
  });

  // The model can only ask for an image on a handle the sandbox gave it, and
  // the resolved bytes still go through the sandbox's own gate.
  it("resolves and adopts an image the model asks for on a real target", async () => {
    const asset = `/api/projects/p/assets/${"a".repeat(64)}.webp`;
    const resolveImage = vi.fn(async () => ({ ok: true as const, url: asset, source: "generated" as const }));
    const runtime = realPost({ mode: "image", sequence: [], calls: [], resolveImage });

    const events = await invoke(runtime.post);

    expect(resolveImage).toHaveBeenCalledTimes(1);
    expect((resolveImage.mock.calls as unknown as [{ subject: string; mediaType: string }][])[0]![0])
      .toMatchObject({ subject: "taller de relojes", mediaType: "photo" });
    const preview = events.find((event) => event.event === "preview");
    expect(String(preview?.data.html)).toContain(asset);
    expect(events.filter((event) => event.event === "error")).toHaveLength(0);
  });

  it("never reaches a paid provider before the safe baseline exists", async () => {
    const calls: string[] = [];
    const runtime = realPost({ mode: "improve", sequence: [], calls });
    await invoke(runtime.post);
    // The baseline is assembled, filled, sealed and rendered locally; the first
    // paid call can only happen after it exists.
    expect(runtime.renderedDocuments.length).toBeGreaterThan(0);
    expect(runtime.timeline[0]).toBe("render");
    expect(runtime.timeline).toContain("provider");
  });

  it("retains delivered telemetry through the default route sink without leaking page bytes", async () => {
    const retained: Array<{ outcome: string; paidCalls: unknown[] }> = [];
    vi.spyOn(console, "info").mockImplementation((line) => { retained.push(JSON.parse(String(line))); });
    mocks.commitAtomic.mockResolvedValue(undefined);

    await invoke(realPost({ mode: "improve", sequence: [], calls: [], defaultTelemetry: true }).post);
    await invoke(realPost({ mode: "down", sequence: [], calls: [], defaultTelemetry: true }).post);

    expect(retained.map((event) => event.outcome)).toEqual(["delivered", "delivered"]);
    expect(JSON.stringify(retained)).not.toMatch(/"(?:userId|prompt|copy|html|screenshot|url|providerBody|credential|secret)"\s*:/i);
    expect(JSON.stringify(retained)).not.toContain("<!doctype");
  });

  it("fails before any paid work when the catalog cannot cover the niche's roles", async () => {
    const calls: string[] = [];
    const runtime = realPost({ mode: "improve", sequence: [], calls });
    const response = await runtime.post(new Request("http://localhost/api/curate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: NICHE_BRIEF }),
    }));
    const events = parseSse(await response.text());
    // GLM used to invent the missing section; the provider-free baseline can
    // only use section types the catalog actually holds.
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
  });

  it("fails closed before providers when required Fable budget configuration is absent", async () => {
    for (const key of ["OPENLEN_FABLE_RATE_CARD_VERSION", "OPENLEN_FABLE_MXN_PER_USD", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"]) delete process.env[key];
    const post = createCuratePost({ runAiCreationDeps: { listSections: vi.fn(async () => [...CATALOG]) } });

    const events = await invoke(post);

    // No provider is reachable without a page budget, so the request dies at
    // the composition root — before the catalog, the baseline or any paid call.
    expect(events.filter((event) => event.event === "error")).toEqual([expect.objectContaining({ data: expect.objectContaining({ kind: "composition_failed" }) })]);
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it.each([undefined, "0", "100", "1.5", "garbage"])(
    "fails closed before runtime, provider, project, or debit when rollout percent is %s",
    async (rolloutPercent) => {
      if (rolloutPercent === undefined) delete process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT;
      else process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT = rolloutPercent;
      const runAiCreationDeps = { listSections: vi.fn(async () => [...CATALOG]) };
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
    const runAiCreationDeps = { listSections: vi.fn(async () => [...CATALOG]) };
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
