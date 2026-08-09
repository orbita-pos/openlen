import { describe, expect, it, vi } from "vitest";
import { CreativeDirectionSchema, SkeletonInventorySchema } from "./creative-contracts";
import { buildVisualRepairStreamRequest, generateVisualRepairPlan, type VisualRepairPlanProvider } from "./generate-visual-repair";
import { VisualQualityVerdictSchema } from "./visual-repair-contracts";
import { COLORING_DIRECTION, COLORING_PLAN } from "./creative-fixtures.test-support";

const REQUEST = {
  direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
  inventory: SkeletonInventorySchema.parse({
    schemaVersion: "skeleton-inventory/1.0", templateId: "fixture", availableTokens: ["--ol-accent"],
    styleHooks: [], assetSlots: [], structuralFingerprint: `sha256:${"a".repeat(64)}`,
  }),
  verdict: VisualQualityVerdictSchema.parse({
    schemaVersion: "visual-quality-verdict/2.0", decision: "repair",
    scores: { themeRecognition: 5, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 6, briefAdherence: 5 },
    issues: [{ code: "palette_mismatch", severity: "critical", hookId: null, explanation: "Palette misses the intended mood." }],
  }),
};

const READY = { schemaVersion: "visual-repair-response/1.0", plan: { ...COLORING_PLAN, tokens: { "--ol-accent": "#E85D9E" }, cssOverride: [], assets: [] } };

describe("generateVisualRepairPlan", () => {
  it("disables dynamic thinking for the bounded JSON repair plan", () => {
    const streamRequest = buildVisualRepairStreamRequest(REQUEST, "gemini-2.5-flash");
    expect(streamRequest).toMatchObject({
      model: "gemini-2.5-flash",
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
      thinkingBudget: 0,
      temperature: 0,
      responseSchema: {
        type: "OBJECT",
        properties: {
          schemaVersion: { type: "STRING", enum: ["visual-repair-response/1.0"] },
          plan: {
            type: "OBJECT",
            properties: {
              schemaVersion: { type: "STRING", enum: ["skeleton-adaptation-plan/1.0"] },
              tokens: { type: "OBJECT" },
              cssOverride: { type: "ARRAY", maxItems: 12 },
              assets: { type: "ARRAY", maxItems: 12 },
            },
            required: ["schemaVersion", "tokens", "cssOverride", "assets"],
          },
        },
        required: ["schemaVersion", "plan"],
      },
    });
    expect(streamRequest.messages[0]?.content).toContain(
      'Return exactly one JSON object shaped as {"schemaVersion":"visual-repair-response/1.0","plan":{...}}.',
    );
    expect(JSON.stringify(streamRequest.responseSchema)).not.toContain("additionalProperties");
  });

  it("sends one allowlisted request and accepts only a strict bounded plan", async () => {
    let payload: unknown;
    const provider: VisualRepairPlanProvider = { generate: vi.fn(async (request) => {
      payload = request;
      return { text: JSON.stringify(READY), usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, thinkingTokens: 2 } };
    }) };
    const result = await generateVisualRepairPlan({ ...REQUEST, html: "<html>secret</html>", copy: "secret copy" } as typeof REQUEST, { provider });
    expect(result).toMatchObject({ ok: true, plan: READY.plan, usage: { inputTokens: 10 } });
    expect(payload).toEqual(REQUEST);
    expect(JSON.stringify(payload)).not.toMatch(/<html|secret copy|dataBase64|https?:\/\//i);
  });

  it.each([
    ["invalid_json", "not-json"],
    ["future_version", JSON.stringify({ ...READY, schemaVersion: "visual-repair-response/2.0" })],
    ["schema", JSON.stringify({ ...READY, extra: true })],
    ["schema", JSON.stringify({ ...READY, plan: { ...READY.plan, tokens: { "--evil": "red" } } })],
  ])("rejects %s responses without partial plans", async (kind, text) => {
    const result = await generateVisualRepairPlan(REQUEST, { provider: { generate: async () => ({ text, usage: { inputTokens: 3, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 } }) } });
    expect(result).toMatchObject({ ok: false, kind, usage: { inputTokens: 3 } });
    expect(result).not.toHaveProperty("plan");
  });

  it("does not call a provider without a key", async () => {
    const factory = vi.fn();
    const result = await generateVisualRepairPlan(REQUEST, { apiKey: "", providerFactory: factory });
    expect(result).toMatchObject({ ok: false, kind: "missing_api_key" });
    expect(factory).not.toHaveBeenCalled();
  });
});
