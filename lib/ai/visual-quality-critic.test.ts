import { describe, expect, it, vi } from "vitest";

import type { StreamEvent, StreamRequest } from "../ai-gateway";
import { CreativeDirectionSchema } from "../generation/creative-contracts";
import { IntentAnalysisSchema } from "../generation/contracts";
import { COLORING_DIRECTION } from "../generation/creative-fixtures.test-support";
import { critiqueVisualQuality, type VisualQualityCriticProviderLike } from "./visual-quality-critic";

const INTENT = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: {
    siteType: "creative_platform",
    requiredSections: ["gallery", "activities"],
    primaryActions: ["start_coloring"],
    contentModel: "interactive_content",
  },
  audience: { primary: "children", ageRange: "ages_4_10", secondary: ["parents"] },
  domains: ["coloring", "children_creativity"],
  emotionalGoals: ["playful", "magical"],
  requiredVisualSignals: ["pastel", "rounded", "illustrated"],
  forbiddenVisualSignals: ["corporate", "generic_education"],
  explicitConstraints: ["raw secret brief text"],
  ambiguities: ["private ambiguity"],
  confidence: 0.95,
});

const IMAGES = {
  desktop: { mimeType: "image/jpeg", dataBase64: Buffer.from("desktop-secret").toString("base64") },
  mobile: { mimeType: "image/jpeg", dataBase64: Buffer.from("mobile-secret").toString("base64") },
};
const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);

const CLEAN = {
  schemaVersion: "visual-quality-verdict/2.1",
  decision: "keep",
  nonrepairableReason: "none",
  scores: {
    themeRecognition: 9,
    visualHierarchy: 8,
    componentCoherence: 8,
    mobileReadability: 9,
    imageryRelevance: 8,
    briefAdherence: 9,
  },
  issues: [],
};

function providerFrom(events: StreamEvent[], capture?: (request: StreamRequest, signal?: AbortSignal) => void): VisualQualityCriticProviderLike {
  return {
    stream(request, options) {
      capture?.(request, options.signal);
      return (async function* () {
        for (const event of events) yield event;
      })();
    },
  };
}

const INPUT = {
  intent: INTENT,
  direction: DIRECTION,
  orderedRoles: ["header", "hero", "features", "footer"],
  route: "template_skeleton" as const,
  images: IMAGES,
  model: "critic-test",
  apiKey: "test-only",
};

describe("critiqueVisualQuality", () => {
  it("sends two images and returns a strict v2 verdict", async () => {
    let captured: StreamRequest | undefined;
    const result = await critiqueVisualQuality(INPUT, {
      provider: providerFrom([
        { type: "text_delta", text: JSON.stringify(CLEAN) },
        { type: "done", stopReason: { kind: "end_turn" } },
      ], (request) => { captured = request; }),
    });

    expect(result).toMatchObject({ ok: true, verdict: CLEAN, promptVersion: "visual-quality-critic/2.3" });
    expect(captured).toMatchObject({
      images: [IMAGES.desktop, IMAGES.mobile],
      temperature: 0,
      thinkingBudget: 0,
      responseMimeType: "application/json",
      responseSchema: {
        properties: {
          nonrepairableReason: {
            type: "STRING",
            enum: ["none", "primary_content_absent", "primary_content_hidden", "structurally_unusable"],
          },
          issues: {
            items: {
              properties: {
                explanation: { type: "STRING", maxLength: 180 },
              },
            },
          },
        },
      },
    });
    expect(captured?.responseSchema?.required).toEqual(expect.arrayContaining(["nonrepairableReason"]));
    expect(captured?.messages[0]?.content).toContain("one short sentence of 160 characters or fewer");
  });

  it("builds the prompt from the allowlisted intent projection only", async () => {
    let prompt = "";
    await critiqueVisualQuality(INPUT, {
      provider: providerFrom([{ type: "text_delta", text: JSON.stringify(CLEAN) }], (request) => {
        prompt = request.messages[0]?.content ?? "";
      }),
    });

    expect(prompt).toContain("children_creativity");
    expect(prompt).toContain("generic_education");
    expect(prompt).toContain("creative_platform");
    expect(prompt).toContain('"requiredSections":["gallery","activities"]');
    expect(prompt).toContain("start_coloring");
    expect(prompt).toContain("soft_bordered");
    expect(prompt).toContain("hand_drawn");
    expect(prompt).toContain('"radiusScale":1');
    expect(prompt).toContain("Missing photography, abstract imagery, palette, typography, spacing and component styling are repairable");
    expect(prompt).toContain("Never use nonrepairable for an ordinary visual mismatch");
    expect(prompt).toContain("Use repair only when the visible defect can be corrected without changing copy or structure");
    expect(prompt).toContain("keep requires no visible contradiction of the creativeDirection");
    expect(prompt).toContain("A polished page can still require repair");
    expect(prompt).toContain("Set every hookId to null");
    expect(prompt).not.toContain("raw secret brief text");
    expect(prompt).not.toContain("private ambiguity");
    expect(prompt).not.toContain("desktop-secret");
    expect(prompt).not.toMatch(/https?:\/\/|<html|dataBase64/i);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["future version", JSON.stringify({ ...CLEAN, schemaVersion: "visual-quality-verdict/3.0" })],
    ["unknown keys", JSON.stringify({ ...CLEAN, private: true })],
    ["incoherent keep", JSON.stringify({ ...CLEAN, scores: { ...CLEAN.scores, imageryRelevance: 6 } })],
    ["incoherent nonrepairable", JSON.stringify({ ...CLEAN, decision: "nonrepairable" })],
  ])("rejects %s without salvaging", async (_name, text) => {
    const result = await critiqueVisualQuality(INPUT, {
      provider: providerFrom([{ type: "text_delta", text }]),
    });
    expect(result).toMatchObject({ ok: false, kind: "invalid_response" });
  });

  it("preserves usage on invalid output and done-error", async () => {
    const usage: StreamEvent = { type: "usage", inputTokens: 10, outputTokens: 2, cachedTokens: 3, thinkingTokens: 4 };
    const invalid = await critiqueVisualQuality(INPUT, {
      provider: providerFrom([usage, { type: "text_delta", text: "{}" }]),
    });
    expect(invalid).toMatchObject({ ok: false, kind: "invalid_response", usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 3, thinkingTokens: 4 } });

    const stopped = await critiqueVisualQuality(INPUT, {
      provider: providerFrom([usage, { type: "done", stopReason: { kind: "error", error: "private upstream body" } }]),
    });
    expect(stopped).toMatchObject({ ok: false, kind: "provider_error", usage: { inputTokens: 10 } });
    expect(JSON.stringify(stopped)).not.toContain("private upstream body");
  });

  it("replaces provider explanation prose with deterministic redacted text", async () => {
    const providerVerdict = {
      ...CLEAN,
      decision: "repair",
      scores: { ...CLEAN.scores, componentCoherence: 5 },
      issues: [{
        code: "component_treatment_mismatch",
        severity: "warning",
        hookId: null,
        explanation: "border-radius:0; see https://private.example/provider-output",
      }],
    };
    const result = await critiqueVisualQuality(INPUT, {
      provider: providerFrom([{ type: "text_delta", text: JSON.stringify(providerVerdict) }]),
    });
    expect(result).toMatchObject({
      ok: true,
      verdict: { issues: [{ code: "component_treatment_mismatch", explanation: "Component treatment conflicts with the approved creative direction." }] },
    });
    expect(JSON.stringify(result)).not.toMatch(/border-radius|private\.example/i);
  });

  it("normalizes keep with reported issues to repair for closed-loop proof", async () => {
    const inconsistent = {
      ...CLEAN,
      issues: [{ code: "component_treatment_mismatch", severity: "warning", hookId: null, explanation: "Square components conflict with the direction." }],
    };
    const result = await critiqueVisualQuality(INPUT, {
      provider: providerFrom([{ type: "text_delta", text: JSON.stringify(inconsistent) }]),
    });
    expect(result).toMatchObject({ ok: true, verdict: { decision: "repair", issues: [{ code: "component_treatment_mismatch" }] } });
  });

  it("preserves usage when the stream throws", async () => {
    const provider: VisualQualityCriticProviderLike = {
      stream() {
        return (async function* () {
          yield { type: "usage", inputTokens: 7, outputTokens: 1, cachedTokens: 0, thinkingTokens: 2 } as StreamEvent;
          throw new Error("private provider response");
        })();
      },
    };
    const result = await critiqueVisualQuality(INPUT, { provider });
    expect(result).toMatchObject({ ok: false, kind: "provider_error", usage: { inputTokens: 7 } });
    expect(JSON.stringify(result)).not.toContain("private provider response");
  });

  it("aborts and returns timeout when the provider stalls", async () => {
    let signal: AbortSignal | undefined;
    const provider: VisualQualityCriticProviderLike = {
      stream(_request, options) {
        signal = options.signal;
        return (async function* () {
          await new Promise(() => undefined);
          yield { type: "text_delta", text: "never" } as StreamEvent;
        })();
      },
    };
    const result = await critiqueVisualQuality(INPUT, { provider, timeoutMs: 5 });
    expect(result).toMatchObject({ ok: false, kind: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("does not construct or call a provider without an API key", async () => {
    const providerFactory = vi.fn();
    const result = await critiqueVisualQuality({ ...INPUT, apiKey: "" }, { providerFactory });
    expect(result).toMatchObject({ ok: false, kind: "missing_api_key" });
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("maps provider construction failures to a redacted fail-open result", async () => {
    const result = await critiqueVisualQuality(INPUT, {
      providerFactory: () => { throw new Error("private constructor detail"); },
    });
    expect(result).toMatchObject({ ok: false, kind: "provider_error" });
    expect(JSON.stringify(result)).not.toContain("private constructor detail");
  });

  it("returns before provider construction when renders are absent", async () => {
    const providerFactory = vi.fn();
    const result = await critiqueVisualQuality({ ...INPUT, images: null }, { providerFactory });
    expect(result).toMatchObject({ ok: false, kind: "render_unavailable" });
    expect(providerFactory).not.toHaveBeenCalled();
  });
});
