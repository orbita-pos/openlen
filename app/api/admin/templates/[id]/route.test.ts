import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTemplateHtmlIssue: vi.fn(),
  getTemplate: vi.fn(),
  requireAdmin: vi.fn(),
  safeParse: vi.fn(),
  upsertTemplate: vi.fn(),
}));

vi.mock("@/lib/auth/admin-only", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/templates/admin-schemas", () => ({
  UpdateSchema: { safeParse: mocks.safeParse },
  findTemplateHtmlIssue: mocks.findTemplateHtmlIssue,
}));

vi.mock("@/lib/templates/store", () => ({
  archiveTemplate: vi.fn(),
  getTemplate: mocks.getTemplate,
  upsertTemplate: mocks.upsertTemplate,
}));

import { PUT } from "./route";

const REVIEWED = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["children_entertainment"],
  audiences: ["children"],
  ageRanges: ["5_10"],
  emotionalRegisters: ["playful"],
  visualArchetypes: ["illustrated_creative_play"],
  visualSignals: ["child_friendly_illustration"],
  layoutTraits: ["image_forward"],
  requiredAssetTypes: ["illustration"],
  negativeTags: ["enterprise_b2b"],
  supportedSiteTypes: ["content_platform"],
  supportedSectionRoles: ["hero"],
  themeability: "high",
  identityStrength: "high",
  reviewStatus: "reviewed",
} as const;

const existing = {
  id: "kids",
  name: "Kids",
  family: "education",
  accent: "#F472B6",
  pitch: "Creative play",
  description: "Illustrated activities for children",
  mode: "light",
  visualMetadata: REVIEWED,
  storageKey: "templates/kids-hash.html",
  storageUrl: "https://storage.example/kids.html",
  contentHash: "hash",
  size: 4,
  pages: [],
  status: "published",
  thumbnailUrl: null,
  tileUrl: null,
  screenshotUrl: null,
  featured: false,
  createdAt: new Date("2026-08-03T00:00:00.000Z"),
  updatedAt: new Date("2026-08-03T00:00:00.000Z"),
  publishedAt: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.getTemplate.mockResolvedValue(existing);
  mocks.safeParse.mockReturnValue({
    success: true,
    data: { html: "<!doctype html><html><body>Updated</body></html>" },
  });
  mocks.findTemplateHtmlIssue.mockReturnValue(null);
  mocks.upsertTemplate.mockResolvedValue(existing);
});

describe("PUT /api/admin/templates/[id] visual metadata", () => {
  it("preserves reviewed metadata when an admin PUT omits the field", async () => {
    const response = await PUT(
      new Request("http://localhost/api/admin/templates/kids", { method: "PUT", body: "{}" }),
      { params: Promise.resolve({ id: "kids" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertTemplate).toHaveBeenCalledWith(expect.objectContaining({
      visualMetadata: REVIEWED,
    }));
  });
});
