import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2Q==";
const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

function donorHtml(id: string, type: string): string {
  return `<section data-sec="${id}"><h2>MORADA ${type}</h2><p>Donor copy for ${type}</p><a href="#">Read donor details</a></section>`;
}

/** A real published inventory: the provider-free baseline composes from these,
 *  so the route needs enough roles to resolve a plan. */
function section(id: string, type: string): SectionRecord {
  const html = donorHtml(id, type);
  return {
    id, type, name: id, variantLabel: id, rootTag: "section", mode: "cream",
    storageKey: `sections/${id}-${shortHash(html)}.html`, storageUrl: `memory://${id}`,
    contentHash: shortHash(html), size: html.length, designTokens: {}, fonts: null,
    needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0", sourceTemplateId: `donor-${id}`,
      sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: 0,
      extractionVersion: "template-band-extractor/1.0", sourceHash: `sha256:${"a".repeat(64)}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0", role: type,
      layoutArchetypes: ["centered"], domains: ["children_creativity"], audiences: ["children"], moods: ["playful"], negativeSignals: [],
    },
    status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  } as SectionRecord;
}

const RECORDS = [
  section("navbar-11", "navbar"), section("hero-11", "hero"), section("gallery-11", "gallery"),
  section("features-11", "features"), section("features-12", "features"), section("features-13", "features"),
  section("footer-11", "footer"),
];
const FRAGMENTS = new Map(RECORDS.map((record) => [record.storageUrl, donorHtml(record.id, record.type)]));

const AUTHORED = [
  '<!doctype html><html lang="es"><head><title>Mundo Pincel</title>',
  '<script src="https://cdn.tailwindcss.com"></script></head>',
  "<body><header><h1>Mundo Pincel</h1></header><main><p>Colorea, juega y crea historias</p></main></body></html>",
].join("");

interface SseEvent { event: string; data: Record<string, unknown> }
function parseSse(text: string): SseEvent[] {
  return text.trim().split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    return { event: lines[0]!.slice(7), data: JSON.parse(lines[1]!.slice(6)) as Record<string, unknown> };
  });
}

/**
 * The creative boundary is now one shape: a plain-text completion. `mode` is
 * the only axis the route's delivery behaviour still depends on.
 */
function documentBoundary(options: { mode: "authored" | "provider_failure" | "no_document"; calls: string[] }): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string; user: string };
    options.calls.push(`${body.model}:${body.user}`);
    if (options.mode === "provider_failure") {
      return new Response(JSON.stringify({ error: { message: "upstream" } }), { status: 503, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "cmpl-private",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: options.mode === "authored" ? AUTHORED : "No puedo generar eso." } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 2 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function realPost(options: { mode?: "authored" | "provider_failure" | "no_document"; sequence: string[]; calls: string[]; defaultTelemetry?: boolean }) {
  const renderedDocuments: string[] = [];
  const documentFetch = vi.fn(documentBoundary({ mode: options.mode ?? "authored", calls: options.calls }));
  const telemetrySink = vi.fn(async (event) => { options.sequence.push(`telemetry:${event.outcome}`); });
  const renderViewports = vi.fn(async (html: string) => {
    renderedDocuments.push(html);
    return { desktop: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobile: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false };
  });
  return {
    telemetrySink, documentFetch, renderedDocuments, renderViewports,
    post: createCuratePost({
      runAiCreationDeps: {
        listSections: vi.fn(async () => RECORDS),
        fableRuntimeOptions: {
          budgetConfig: { rateCardVersion: "test", mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 },
          fireworksClientOptions: { apiKey: "fixture-fireworks-key", fetchImpl: vi.fn() as unknown as typeof fetch, now: () => 100 },
          documentClientOptions: { apiKey: "fixture-fireworks-key", fetchImpl: documentFetch as unknown as typeof fetch, now: () => 100 },
          renderViewports,
          sectionFragmentFetch: async (url) => FRAGMENTS.get(url) ?? null,
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

  it("delivers the authored page through the real root and commits exactly once", async () => {
    const sequence: string[] = [];
    mocks.commitAtomic.mockImplementation(async () => { sequence.push("project", "debit"); });
    const calls: string[] = [];
    const runtime = realPost({ mode: "authored", sequence, calls });

    const events = await invoke(runtime.post);

    // A clean document must cost exactly one paid turn; the repair is for real problems.
    expect(calls.map((call) => call.split("-").pop()), JSON.stringify(calls)).toEqual(["1"]);
    expect(mocks.commitAtomic).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.event === "preview")).toHaveLength(1);
    expect(events.filter((event) => event.event === "done")).toHaveLength(1);
    expect(events.filter((event) => event.event === "error")).toHaveLength(0);
    expect(events.find((event) => event.event === "done")?.data).toMatchObject({ route: "creative_document", templateId: null });
    expect(runtime.telemetrySink).toHaveBeenCalledWith(expect.objectContaining({ outcome: "delivered" }));
    expect(sequence).toEqual(["project", "debit", "telemetry:delivered"]);
  });

  // The cutover's whole point, exercised through the real POST: the request
  // still produces a page, a project, and a done event.
  it.each([
    ["a provider failure", "provider_failure" as const],
    ["a reply with no document", "no_document" as const],
  ])("delivers the baseline through the real root on %s", async (_label, mode) => {
    const sequence: string[] = [];
    mocks.commitAtomic.mockImplementation(async () => { sequence.push("project", "debit"); });
    const runtime = realPost({ mode, sequence, calls: [] });

    const events = await invoke(runtime.post);

    expect(events.filter((event) => event.event === "error"), JSON.stringify(events)).toHaveLength(0);
    expect(events.filter((event) => event.event === "preview")).toHaveLength(1);
    expect(events.filter((event) => event.event === "done")).toHaveLength(1);
    expect(events.find((event) => event.event === "done")?.data).toMatchObject({ route: "section_composition" });
    expect(mocks.commitAtomic).toHaveBeenCalledOnce();
  });

  // Billing decision 2026-08-14: the baseline is a fallback the user did not
  // ask for, so OpenLen absorbs the failed attempt instead of charging for it.
  it("charges nothing when the delivered page is the baseline", async () => {
    const runtime = realPost({ mode: "provider_failure", sequence: [], calls: [] });

    await invoke(runtime.post);

    expect(mocks.commitAtomic).toHaveBeenCalledOnce();
    expect(mocks.commitAtomic.mock.calls[0]![0]).toMatchObject({ credits: 0 });
  });

  it("retains redacted telemetry through the default route sink", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line) => { lines.push(String(line)); });

    await invoke(realPost({ mode: "authored", sequence: [], calls: [], defaultTelemetry: true }).post);

    const retained = lines.flatMap((line) => {
      try { return [JSON.parse(line) as { outcome: string; paidCalls: unknown[] }]; } catch { return []; }
    });
    expect(retained.map((event) => event.outcome), JSON.stringify(lines)).toEqual(["delivered"]);
    expect(JSON.stringify(retained)).not.toMatch(/"(?:userId|prompt|copy|html|screenshot|url|providerBody|credential|secret)"\s*:/i);
    expect(JSON.stringify(retained)).not.toContain("Mundo Pincel");
  });

  it("fails closed before providers when required Fable budget configuration is absent", async () => {
    for (const key of ["OPENLEN_FABLE_RATE_CARD_VERSION", "OPENLEN_FABLE_MXN_PER_USD", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"]) delete process.env[key];
    const post = createCuratePost({ runAiCreationDeps: { listSections: vi.fn(async () => RECORDS) } });

    const events = await invoke(post);

    expect(events.filter((event) => event.event === "error")).toEqual([expect.objectContaining({ data: expect.objectContaining({ kind: "baseline_invalid" }) })]);
    expect(mocks.commitAtomic).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it.each([undefined, "0", "100", "1.5", "garbage"])(
    "fails closed before runtime, provider, project, or debit when rollout percent is %s",
    async (rolloutPercent) => {
      if (rolloutPercent === undefined) delete process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT;
      else process.env.OPENLEN_AI_CREATION_ROLLOUT_PERCENT = rolloutPercent;
      const runAiCreationDeps = { listSections: vi.fn(async () => RECORDS) };
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
    const runAiCreationDeps = { listSections: vi.fn(async () => RECORDS) };
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
