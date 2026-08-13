import { describe, expect, it, vi } from "vitest";

import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { CreativeDirectionSchema } from "./creative-contracts";
import { createPageDesignProgram } from "./page-design-program";
import type { VisualScoutSuccess } from "./visual-candidate-scout";
import type { FireworksJsonClient } from "../ai/fireworks-client";
import type { FireworksJsonRequest } from "../ai/fireworks-contracts";

const direction = CreativeDirectionSchema.parse(COLORING_DIRECTION);

const scout = {
  ok: true,
  candidates: [{
    candidateId: "hero-safe",
    ordinal: 0,
    requestedRole: "hero",
    componentType: "hero",
    sourceKind: "template_derived",
    sourceTemplateId: "donor-safe",
    sourceBandOrdinal: 2,
    structuralFingerprint: `sha256:${"a".repeat(64)}`,
    traits: ["centered", "children_creativity", "playful"],
  }],
  decisions: [{ ordinal: 0, action: "rebuild", candidateId: "hero-safe", usefulTraits: ["playful"], rejectedTraits: ["generic"] }],
  modelId: "accounts/fireworks/models/qwen3p7-plus",
  usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 4, thinkingTokens: 0 },
  durationMs: 1,
  attempts: 1,
} as const satisfies VisualScoutSuccess;

const response = {
  schemaVersion: "adaptive-page-design/1.0",
  narrative: ["hero"],
    direction,
  decisions: scout.decisions,
  rhythm: "storytelling",
  requiredSignals: ["playful"],
  forbiddenSignals: ["generic_saas"],
  imageSlots: [{ slotIndex: 0, ordinal: 0, mediaType: "illustration", subject: "hand_drawn_characters", purpose: "hero_focal", required: true }],
} as const;

describe("createPageDesignProgram", () => {
  it("sends only bounded Qwen observations, candidate metadata, and copy-key names to DeepSeek", async () => {
    let payload = "";
    let requestRole = "";
    let effort = "";
    const client: FireworksJsonClient = {
      async request<T>(request: FireworksJsonRequest<T>) {
        payload = request.messages.map((message) => message.content).join("\n");
        requestRole = request.role;
        effort = request.reasoningEffort;
        const value = request.responseSchema.parse(response);
        return { ok: true, value, modelId: "accounts/fireworks/models/deepseek-v4-flash", usage: { inputTokens: 30, cachedTokens: 4, outputTokens: 12, thinkingTokens: 5 }, durationMs: 3, attempts: 1 };
      },
    };

    const result = await createPageDesignProgram({
      scout,
      requiredRoles: ["hero"],
      initialDirection: direction,
      syntheticIntent: {
        siteType: "content_platform",
        audience: "children",
        domains: ["creative_play"],
        emotionalGoals: ["playful"],
        requiredSignals: ["coloring_art"],
        forbiddenSignals: ["dashboard"],
      },
      copyKeyNames: ["hero.title", "hero.body"],
      requestId: "page-123",
    }, { client });

    expect(result).toMatchObject({ ok: true, program: { rhythm: "storytelling" } });
    expect(requestRole).toBe("reasoner");
    expect(effort).toBe("high");
    expect(payload).toContain("hero.title");
    expect(payload).toContain("donor-safe");
    expect(payload).toContain("playful");
    expect(payload).not.toContain("dataBase64");
    expect(payload).not.toContain("<section");
    expect(payload).not.toContain("storage.invalid");
    expect(payload).not.toContain("Actual private headline");
  });

  it("rejects a planner that mutates Qwen's candidate decisions", async () => {
    const client: FireworksJsonClient = {
      async request<T>(request: FireworksJsonRequest<T>) {
        const parsed = request.responseSchema.safeParse({
          ...response,
          decisions: [{ ...scout.decisions[0], action: "generate", candidateId: null }],
        });
        return parsed.success
          ? { ok: true, value: parsed.data, modelId: "accounts/fireworks/models/deepseek-v4-flash", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 1 }, durationMs: 1, attempts: 1 }
          : { ok: false, code: "schema", modelId: "accounts/fireworks/models/deepseek-v4-flash", usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, thinkingTokens: 1 }, durationMs: 1, attempts: 1 };
      },
    };
    const result = await createPageDesignProgram({
      scout,
      requiredRoles: ["hero"],
      initialDirection: direction,
      syntheticIntent: { siteType: "content_platform", audience: "children", domains: ["creative_play"], emotionalGoals: ["playful"], requiredSignals: [], forbiddenSignals: [] },
      copyKeyNames: ["hero.title"],
      requestId: "page-789",
    }, { client });
    expect(result).toMatchObject({ ok: false, code: "schema", usage: { inputTokens: 1 } });
  });
});
