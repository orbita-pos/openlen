import { describe, expect, it, vi } from "vitest";

import type { FireworksDocumentResult } from "@/lib/ai/fireworks-contracts";
import type { FireworksDocumentClient } from "@/lib/ai/fireworks-document-client";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";
import { sha256 } from "@/lib/generation/content-hash";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import type { SanitizeResult } from "@/lib/html-engine";

import {
  compileCreativeDocument,
  extractHtmlDocument,
  repairInstruction,
  runCreativeDocument,
  type CreativeDocumentDeps,
  type CreativeDocumentInput,
} from "./creative-document";
import { validateCreativeDocumentDelivery } from "./creative-document-delivery";

const MODEL_ID = "accounts/fireworks/models/deepseek-v4-flash-0731";

const DOCUMENT = [
  "<!doctype html><html lang=\"es\"><head><title>Mundo Pincel</title></head>",
  "<body><header><h1>Mundo Pincel</h1></header><main><p>Dibujos para colorear</p></main></body></html>",
].join("");

const SCRIPTED = DOCUMENT
  .replace("</head>", "<script>alert(1)</script></head>")
  .replace("<header>", '<header onclick="go()">');

const PROFILE: BusinessProfileData = { brand: { accent: "#B4236A" } } as BusinessProfileData;

const INTENT: IntentAnalysis = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: { siteType: "marketing", requiredSections: ["header", "hero", "features", "cta", "footer"], primaryActions: [], contentModel: "landing_page" },
  audience: { primary: "familias", secondary: [], ageRange: null },
  domains: ["kids"],
  emotionalGoals: ["playful"],
  requiredVisualSignals: ["crayon_texture"],
  forbiddenVisualSignals: ["corporate_gradient"],
  explicitConstraints: [],
  ambiguities: [],
  confidence: 0.9,
});

const DIRECTION = buildDeterministicCreativeDirection(INTENT).direction;

const INPUT: CreativeDocumentInput = {
  requestId: "proj-1",
  brief: "una pagina infantil de coloreo llamada Mundo Pincel",
  title: "Mundo Pincel",
  profileData: PROFILE,
  creativeDirection: DIRECTION,
  intent: INTENT,
};

function sanitizeResult(html: string | null, removed: Partial<SanitizeResult["removed"]> = {}): SanitizeResult {
  return {
    html,
    errors: [],
    removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0, ...removed },
  };
}

/** Local stand-ins for the Rust engine and headless Chrome; no native calls. */
function passingDeps(overrides: Partial<CreativeDocumentDeps> = {}): CreativeDocumentDeps {
  return {
    normalize: (html) => html,
    sanitize: (html) => sanitizeResult(html),
    finalize: (input) => ({ ok: true, html: input.html }),
    seal: (html) => ({ html: `${html}<meta data-ol-csp>`, sealed: true, scriptHashes: [], externalScripts: [], basesStripped: 0, noopenerAdded: 0, errors: [] }),
    render: async () => ({ desktop: { mimeType: "image/jpeg", dataBase64: "x" }, mobile: { mimeType: "image/jpeg", dataBase64: "x" } }),
    ...overrides,
  };
}

function clientReturning(...results: FireworksDocumentResult[]): { client: FireworksDocumentClient; write: ReturnType<typeof vi.fn> } {
  const queue = [...results];
  const write = vi.fn(async () => queue.shift() ?? results[results.length - 1]!);
  return { client: { write } as unknown as FireworksDocumentClient, write };
}

function textResult(text: string, truncated = false): FireworksDocumentResult {
  return {
    ok: true,
    text,
    truncated,
    usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 20, thinkingTokens: 0 },
    usageKnown: true,
    durationMs: 5,
    modelId: MODEL_ID,
  };
}

describe("extractHtmlDocument", () => {
  it.each([
    ["bare document", DOCUMENT],
    ["preamble prose", `Claro, aquí tienes la página:\n\n${DOCUMENT}`],
    ["markdown fence", "```html\n" + DOCUMENT + "\n```"],
    ["trailing commentary", `${DOCUMENT}\n\nEspero que te guste.`],
    ["no doctype", DOCUMENT.replace("<!doctype html>", "")],
  ])("recovers the document from %s", (_label, text) => {
    expect(extractHtmlDocument(text)).toContain("<title>Mundo Pincel</title>");
  });

  it("returns null when the reply has no document", () => {
    expect(extractHtmlDocument("No puedo generar eso.")).toBeNull();
  });

  it("keeps a truncated document instead of discarding it", () => {
    expect(extractHtmlDocument("<!doctype html><html><head><title>x</title></head><body><p>par")).toContain("<body>");
  });
});

describe("repairInstruction", () => {
  it("names the concrete problem for every rejection it reports", () => {
    const instruction = repairInstruction(["script_removed", "mobile_overflow"]);
    expect(instruction).toContain("<script>");
    expect(instruction).toContain("390px");
  });

  it("does not repeat an instruction for duplicated rejections", () => {
    const instruction = repairInstruction(["mobile_overflow", "mobile_overflow"]);
    expect(instruction.split("\n")).toHaveLength(1);
  });
});

describe("compileCreativeDocument", () => {
  it("seals a clean document", async () => {
    const result = await compileCreativeDocument(DOCUMENT, { title: "Mundo Pincel", profileData: PROFILE, truncated: false, tolerateRemovals: false }, passingDeps());
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toContain("data-ol-csp");
  });

  it("rejects a reserved editor marker outright", async () => {
    const deps = passingDeps({ sanitize: () => sanitizeResult(null) });
    await expect(compileCreativeDocument(DOCUMENT, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: true }, deps))
      .resolves.toEqual({ ok: false, rejections: ["reserved_marker"] });
  });

  it("asks for a rewrite when the model authored JavaScript on a non-final attempt", async () => {
    await expect(compileCreativeDocument(SCRIPTED, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: false }, passingDeps()))
      .resolves.toEqual({ ok: false, rejections: ["script_removed", "event_handler_removed"] });
  });

  it("ships the stripped page rather than nothing on the final attempt", async () => {
    const result = await compileCreativeDocument(SCRIPTED, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: true }, passingDeps());
    expect(result).toMatchObject({ ok: true, warnings: ["script_removed", "event_handler_removed"] });
  });

  // OpenLen's own normalizer injects Tailwind carrier scripts, so the allowed
  // CDN tag must never be read as the model reaching for JavaScript.
  it("does not spend a repair turn on the allowlisted Tailwind CDN tag", async () => {
    const withCdn = DOCUMENT.replace("</head>", '<script src="https://cdn.tailwindcss.com"></script></head>');
    await expect(compileCreativeDocument(withCdn, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: false }, passingDeps()))
      .resolves.toMatchObject({ ok: true, warnings: [] });
  });

  it.each([
    ["mobile_overflow", { mobileOverflow: true }],
    ["invalid_geometry", { invalidGeometry: true }],
  ])("reports %s from the deterministic render", async (expected, rendered) => {
    const deps = passingDeps({
      render: async () => ({ desktop: { mimeType: "image/jpeg", dataBase64: "x" }, mobile: { mimeType: "image/jpeg", dataBase64: "x" }, ...rendered }),
    });
    await expect(compileCreativeDocument(DOCUMENT, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: true }, deps))
      .resolves.toEqual({ ok: false, rejections: [expected] });
  });

  it("survives a render that throws", async () => {
    const deps = passingDeps({ render: async () => { throw new Error("chrome died"); } });
    await expect(compileCreativeDocument(DOCUMENT, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: true }, deps))
      .resolves.toEqual({ ok: false, rejections: ["render_unavailable"] });
  });

  it("rejects a document with no title", async () => {
    const untitled = "<!doctype html><html><head></head><body><p>hola</p></body></html>";
    await expect(compileCreativeDocument(untitled, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: true }, passingDeps()))
      .resolves.toMatchObject({ ok: false, rejections: ["missing_title"] });
  });

  it("reports a failed seal instead of publishing an unsealed page", async () => {
    const deps = passingDeps({ seal: (html) => ({ html, sealed: false, scriptHashes: [], externalScripts: [], basesStripped: 0, noopenerAdded: 0, errors: [] }) });
    await expect(compileCreativeDocument(DOCUMENT, { title: "x", profileData: PROFILE, truncated: false, tolerateRemovals: true }, deps))
      .resolves.toEqual({ ok: false, rejections: ["seal_failed"] });
  });
});

describe("runCreativeDocument", () => {
  it("delivers a first-attempt document with matching provenance", async () => {
    const { client, write } = clientReturning(textResult(DOCUMENT));
    const outcome = await runCreativeDocument(INPUT, { ...passingDeps(), client });

    expect(outcome).toMatchObject({ turns: 1, stoppedBy: "authored", rejections: [] });
    expect(write).toHaveBeenCalledTimes(1);
    const candidate = outcome.candidate!;
    expect(candidate.source).toBe("document");
    expect(candidate.visualEngine.documentManifest).toMatchObject({ turns: 1, repaired: false, modelId: MODEL_ID, outputHash: sha256(candidate.html) });
    expect(validateCreativeDocumentDelivery({ html: candidate.html, visualEngine: candidate.visualEngine })).toMatchObject({ ok: true });
  });

  it("repairs once with a concrete instruction and delivers the fix", async () => {
    const overflowing = DOCUMENT.replace("</body>", "<div style=\"width:2000px\"></div></body>");
    const { client, write } = clientReturning(textResult(overflowing), textResult(DOCUMENT));
    let call = 0;
    const outcome = await runCreativeDocument(INPUT, {
      ...passingDeps({
        render: async () => {
          call += 1;
          return { desktop: { mimeType: "image/jpeg", dataBase64: "x" }, mobile: { mimeType: "image/jpeg", dataBase64: "x" }, mobileOverflow: call === 1 };
        },
      }),
      client,
    });

    expect(outcome).toMatchObject({ turns: 2, stoppedBy: "repaired", rejections: ["mobile_overflow"] });
    expect(outcome.candidate?.visualEngine.documentManifest).toMatchObject({ turns: 2, repaired: true });
    const repairTurn = write.mock.calls[1]![0] as { messages: { role: string; content: string }[] };
    expect(repairTurn.messages).toHaveLength(4);
    expect(repairTurn.messages[3]!.content).toContain("390px");
  });

  it("stops after exactly two turns and keeps nothing when both are unusable", async () => {
    const { client, write } = clientReturning(textResult("lo siento"), textResult("tampoco"));
    const outcome = await runCreativeDocument(INPUT, { ...passingDeps(), client });

    expect(outcome).toMatchObject({ candidate: null, turns: 2, stoppedBy: "rejected", rejections: ["no_document", "no_document"] });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["timeout", "provider"],
    ["http", "provider"],
    ["missing_key", "provider"],
    ["empty", "provider"],
    ["budget_exceeded", "budget"],
  ])("returns no candidate on %s without throwing", async (code, stoppedBy) => {
    const { client } = clientReturning({ ok: false, code: code as "timeout", durationMs: 1, modelId: MODEL_ID });
    await expect(runCreativeDocument(INPUT, { ...passingDeps(), client }))
      .resolves.toMatchObject({ candidate: null, stoppedBy });
  });

  it("returns no candidate when the client itself throws", async () => {
    const client = { write: async () => { throw new Error("socket"); } } as unknown as FireworksDocumentClient;
    await expect(runCreativeDocument(INPUT, { ...passingDeps(), client }))
      .resolves.toMatchObject({ candidate: null, stoppedBy: "provider" });
  });

  it("returns no candidate when no client is configured", async () => {
    await expect(runCreativeDocument(INPUT, passingDeps()))
      .resolves.toMatchObject({ candidate: null, turns: 0, stoppedBy: "provider" });
  });

  it("tolerates a telemetry sink that throws", async () => {
    const { client } = clientReturning(textResult(DOCUMENT));
    await expect(runCreativeDocument(INPUT, {
      ...passingDeps(),
      client,
      recordModel: () => { throw new Error("sink down"); },
    })).resolves.toMatchObject({ stoppedBy: "authored" });
  });

  it("sends the brief and the niche signals but never the raw profile object", async () => {
    const { client, write } = clientReturning(textResult(DOCUMENT));
    await runCreativeDocument(INPUT, { ...passingDeps(), client });

    const first = write.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    expect(first.messages[0]!.role).toBe("system");
    expect(first.messages[1]!.content).toContain("Mundo Pincel");
    expect(first.messages[1]!.content).toContain("crayon texture");
    expect(first.messages[1]!.content).toContain("corporate gradient");
  });
});
