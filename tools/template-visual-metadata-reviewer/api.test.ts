import { describe, expect, it, vi } from "vitest";
import {
  ReviewerApiError,
  createReviewerApi,
  encodeReviewerItemRouteSegment,
} from "./api";

const METADATA = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["saas"],
  audiences: ["businesses"],
  ageRanges: [],
  emotionalRegisters: ["technical"],
  visualArchetypes: ["technical_minimal"],
  visualSignals: ["saas_dashboard"],
  layoutTraits: ["dense"],
  requiredAssetTypes: ["product_mockup"],
  negativeTags: [],
  supportedSiteTypes: ["product_landing"],
  supportedSectionRoles: ["hero"],
  themeability: "medium",
  identityStrength: "high",
  reviewStatus: "unreviewed",
};

const SESSION = {
  phase: "review",
  reviewerName: "Safe Reviewer",
  source: {
    artifactVersion: "template-visual-metadata-suggestion-artifact/1.0",
    abbreviatedSha256: "aaaaaaaaaaaa",
  },
  progress: {
    total: 1,
    suggested: 1,
    failed: 0,
    pending: 1,
    approved: 0,
    rejected: 0,
    requiredApprovals: 1,
    remainingApprovals: 1,
    finalExportEnabled: false,
  },
  currentTemplateId: "simple_id",
};

function safeItem(id: string, screenshotEndpoint = `/api/items/${encodeReviewerItemRouteSegment(id)}/screenshot`) {
  return {
    id,
    name: `Template ${id}`,
    screenshotEndpoint,
    metadata: structuredClone(METADATA),
    failureKind: null,
    state: "pending",
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("reviewer API boundary", () => {
  it("uses Task 4 canonical route segments for every item mutation", async () => {
    const expected = new Map([
      ["simple_id", "simple_id"],
      ["~", "~fg"],
      [".", "~Lg"],
      ["..", "~Li4"],
      ["slash/id", "~c2xhc2gvaWQ"],
    ]);
    const paths: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      paths.push(path);
      const match = /^\/api\/items\/([^/]+)\/(?:metadata|decision|reopen)$/.exec(path);
      const itemId = [...expected].find(([, segment]) => segment === match?.[1])?.[0] ?? "simple_id";
      return json({ session: SESSION, items: [safeItem(itemId)] });
    }) as unknown as typeof fetch;
    const api = createReviewerApi(fetchImpl);

    for (const [id, segment] of expected) {
      await api.updateMetadata(id, "domains", ["saas"]);
      await api.decide(id, { action: "rejected", reason: "Unsupported" });
      await api.reopen(id);
      expect(paths.slice(-3)).toEqual([
        `/api/items/${segment}/metadata`,
        `/api/items/${segment}/decision`,
        `/api/items/${segment}/reopen`,
      ]);
    }
  });

  it("accepts only the exact canonical screenshot endpoint for the item ID", async () => {
    const accepted = createReviewerApi(
      vi.fn(async () => json({ items: [safeItem("slash/id")] })) as unknown as typeof fetch,
    );
    await expect(accepted.getItems({})).resolves.toMatchObject([
      { id: "slash/id", screenshotEndpoint: "/api/items/~c2xhc2gvaWQ/screenshot" },
    ]);

    const unsafeEndpoints = [
      "https://templates.openlen.com/image.jpg",
      "//attacker.test/api/items/simple_id/screenshot",
      "/api/items/simple_id/screenshot?q=secret",
      "/api/items/simple_id/screenshot#secret",
      "\\api\\items\\simple_id\\screenshot",
      "/api/items/./screenshot",
      "/api/items/../screenshot",
      "/api/items/~c2ltcGxlX2lk/screenshot",
      "/api/items/other/screenshot",
    ];
    for (const endpoint of unsafeEndpoints) {
      const api = createReviewerApi(
        vi.fn(async () => json({ items: [safeItem("simple_id", endpoint)] })) as unknown as typeof fetch,
      );
      await expect(api.getItems({})).rejects.toMatchObject({
        name: "ReviewerApiError",
        code: "response_invalid",
      });
    }
  });

  it("maps malformed JSON and fixed server errors without exposing response details", async () => {
    const malformed = createReviewerApi(
      vi.fn(async () => new Response("{private", { status: 200 })) as unknown as typeof fetch,
    );
    await expect(malformed.getSession()).rejects.toEqual(
      expect.objectContaining({ name: "ReviewerApiError", code: "response_invalid", status: 200 }),
    );

    const rejected = createReviewerApi(
      vi.fn(async () => json({ error: "request_rejected", privateCause: "disk path" }, 500)) as unknown as typeof fetch,
    );
    const error = await rejected.getSession().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ReviewerApiError);
    expect(error).toMatchObject({ code: "request_rejected", status: 500 });
    expect(JSON.stringify(error)).not.toContain("disk path");
  });

  it("parses mutation envelopes and discards unknown unsafe fields", async () => {
    const fetchImpl = vi.fn(async () => json({
      session: {
        ...SESSION,
        reviewerEmail: "private@example.test",
      },
      items: [{
        ...safeItem("simple_id"),
        evidence: { rawModelResponse: "RAW_SECRET" },
        sourcePath: "C:\\private\\artifact.json",
      }],
      credentials: "PRIVATE_TOKEN",
    })) as unknown as typeof fetch;
    const result = await createReviewerApi(fetchImpl).updateMetadata("simple_id", "domains", ["saas"]);
    const serialized = JSON.stringify(result);

    expect(result).toEqual(SESSION);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("RAW_SECRET");
    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("PRIVATE_TOKEN");
  });
});
