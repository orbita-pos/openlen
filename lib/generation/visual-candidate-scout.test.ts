import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { IntentAnalysisSchema } from "./contracts";
import { CreativeDirectionSchema } from "./creative-contracts";
import { buildSectionCompositionInventory } from "./section-inventory";
import { planAdaptiveSectionComposition } from "./section-plan";
import { scoutVisualCandidates } from "./visual-candidate-scout";
import type { FireworksJsonClient } from "../ai/fireworks-client";
import type { FireworksJsonRequest } from "../ai/fireworks-contracts";
import type { SectionRecord } from "@/lib/sections/store";

const sha12 = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 12);
const VALID_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";

function record(id: string, html: string, negativeSignals: string[] = []): SectionRecord {
  const contentHash = sha12(html);
  return {
    id,
    type: "hero",
    name: `private ${id}`,
    variantLabel: "private variant",
    rootTag: "section",
    mode: "light",
    storageKey: `sections/${id}-${contentHash}.html`,
    storageUrl: `https://storage.invalid/${id}.html`,
    contentHash,
    size: html.length,
    designTokens: null,
    fonts: null,
    needsJs: false,
    hasPlaceholders: false,
    thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0",
      sourceTemplateId: `donor-${id}`,
      sourceTemplateHash: "a".repeat(12),
      sourceBandOrdinal: 0,
      extractionVersion: "template-band-extractor/1.0",
      sourceHash: `sha256:${"a".repeat(64)}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0",
      role: "hero",
      layoutArchetypes: ["centered"],
      domains: ["children_creativity"],
      audiences: ["children"],
      moods: ["playful"],
      negativeSignals,
    },
    status: "published",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: new Date(0),
  } as SectionRecord;
}

const intent = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: { siteType: "content_platform", requiredSections: ["hero"], primaryActions: ["explore"], contentModel: "creative_activities" },
  audience: { primary: "children", ageRange: "age_4_9", secondary: ["parents"] },
  domains: ["creative_play"],
  emotionalGoals: ["playful"],
  requiredVisualSignals: ["coloring_art"],
  forbiddenVisualSignals: ["saas_dashboard"],
  explicitConstraints: ["literal private user request"],
  ambiguities: ["private ambiguity"],
  confidence: 0.95,
});

describe("scoutVisualCandidates", () => {
  it("filters hard negatives before rendering and lets Qwen choose all generate", async () => {
    const safeHtml = '<section data-sec="hero-safe"><h1>safe</h1></section>';
    const rejectedHtml = '<section data-sec="hero-dashboard"><h1>dashboard</h1></section>';
    const inventory = buildSectionCompositionInventory([
      record("hero-dashboard", rejectedHtml, ["dashboard"]),
      record("hero-safe", safeHtml),
    ]);
    const planned = planAdaptiveSectionComposition({
      intent,
      intentHash: `sha256:${"b".repeat(64)}`,
      inventoryHash: inventory.hash,
    });
    if (!planned.ok) throw new Error(planned.code);

    let providerPayload = "";
    let userContent: unknown;
    const client: FireworksJsonClient = {
      async request<T>(request: FireworksJsonRequest<T>) {
        providerPayload = JSON.stringify(request.messages);
        userContent = request.messages[1]?.content;
        const value = request.responseSchema.parse({
          schemaVersion: "adaptive-candidate-decisions/1.0",
          decisions: [{ ordinal: 0, action: "generate", candidateId: null, usefulTraits: [], rejectedTraits: ["dashboard"] }],
        });
        return { ok: true, value, modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 20, cachedTokens: 0, outputTokens: 10, thinkingTokens: 0 }, durationMs: 1, attempts: 1 };
      },
    };
    const fetchText = vi.fn(async (url: string) => url.endsWith("hero-safe.html") ? safeHtml : rejectedHtml);
    const renderContactSheet = vi.fn(async (fragments: readonly { candidateId: string; html: string }[]) => {
      expect(fragments.map((fragment) => fragment.candidateId)).toEqual(["hero-safe"]);
      return { mimeType: "image/jpeg", dataBase64: VALID_JPEG_BASE64 };
    });

    const result = await scoutVisualCandidates({
      plan: planned.plan,
      inventory,
      intent,
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      requestId: "page-123",
    }, { client, fetchText, renderContactSheet });

    expect(result).toMatchObject({ ok: true, requiredRoles: ["hero"], decisions: [{ action: "generate", candidateId: null }] });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(renderContactSheet).toHaveBeenCalledTimes(1);
    expect(providerPayload).toContain("hero-safe");
    expect(userContent).toEqual([
      { type: "text", text: expect.stringContaining("hero-safe") },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${VALID_JPEG_BASE64}` } },
    ]);
    expect(providerPayload).not.toContain("hero-dashboard");
    expect(providerPayload).not.toContain("storage.invalid");
    expect(providerPayload).not.toContain("<section");
    expect(providerPayload).not.toContain("literal private user request");
  });

  it("preserves a redacted gateway failure without a second creative request", async () => {
    const inventory = buildSectionCompositionInventory([]);
    const planned = planAdaptiveSectionComposition({
      intent,
      intentHash: `sha256:${"c".repeat(64)}`,
      inventoryHash: inventory.hash,
    });
    if (!planned.ok) throw new Error(planned.code);
    let requests = 0;
    const client: FireworksJsonClient = {
      async request() {
        requests += 1;
        return {
          ok: false as const,
          code: "schema" as const,
          modelId: "accounts/fireworks/models/qwen3p7-plus",
          usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 4, thinkingTokens: 0 },
          durationMs: 2,
          attempts: 1 as const,
        };
      },
    };

    const result = await scoutVisualCandidates({
      plan: planned.plan,
      inventory,
      intent,
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      requestId: "page-456",
    }, {
      client,
      fetchText: async () => null,
      renderContactSheet: async () => ({ mimeType: "image/jpeg", dataBase64: VALID_JPEG_BASE64 }),
    });

    expect(result).toMatchObject({ ok: false, code: "schema", usage: { inputTokens: 12 } });
    expect(requests).toBe(1);
  });
});
