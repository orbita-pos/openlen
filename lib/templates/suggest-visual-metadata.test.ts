import { describe, expect, it, vi } from "vitest";
import { coerceSuggestedMetadata, suggestVisualMetadata } from "./suggest-visual-metadata";
import type { TemplateRecord } from "./store";

describe("coerceSuggestedMetadata", () => {
  it("forces model suggestions to remain unreviewed", () => {
    const result = coerceSuggestedMetadata({
      schemaVersion: "template-visual-metadata/1.0",
      domains: ["saas"], audiences: ["businesses"], ageRanges: [],
      emotionalRegisters: ["technical"], visualArchetypes: ["technical_minimal"],
      visualSignals: ["saas_dashboard"], layoutTraits: ["dense"],
      requiredAssetTypes: ["product_mockup"], negativeTags: ["children"],
      supportedSiteTypes: ["product_landing"], supportedSectionRoles: ["hero", "features", "pricing", "footer"],
      themeability: "medium", identityStrength: "high", reviewStatus: "reviewed",
    });
    expect(result?.reviewStatus).toBe("unreviewed");
  });

  it("returns null instead of accepting malformed model output", () => {
    expect(coerceSuggestedMetadata({ domains: ["saas"] })).toBeNull();
  });
});

it("sends the screenshot inline and keeps the suggestion unreviewed", async () => {
  const modelValue = {
    schemaVersion: "template-visual-metadata/1.0",
    domains: ["saas"], audiences: ["businesses"], ageRanges: [],
    emotionalRegisters: ["technical"], visualArchetypes: ["technical_minimal"],
    visualSignals: ["saas_dashboard"], layoutTraits: ["dense"],
    requiredAssetTypes: ["product_mockup"], negativeTags: ["children"],
    supportedSiteTypes: ["product_landing"], supportedSectionRoles: ["hero", "features", "footer"],
    themeability: "medium", identityStrength: "high", reviewStatus: "reviewed",
  };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(modelValue) }] } }],
    }), { status: 200 }));
  const result = await suggestVisualMetadata({
    id: "mirror", name: "Mirror", family: "saas", pitch: "Dark SaaS",
    description: "Technical product page", screenshotUrl: "https://example.test/mirror.jpg",
  } as TemplateRecord, { apiKey: "key", fetchImpl });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.metadata.reviewStatus).toBe("unreviewed");
  const request = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
  expect(request.contents[0].parts[1].inlineData.data).toBe("AQID");
});
