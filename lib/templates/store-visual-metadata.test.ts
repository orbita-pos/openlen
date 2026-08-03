import { beforeEach, describe, expect, it, vi } from "vitest";
import { templates } from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  limit: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  select: vi.fn(),
  upload: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    db: {
      from: mocks.from,
      insert: mocks.insert,
      select: mocks.select,
    },
    schema,
  };
});

vi.mock("@/lib/storage/templates", () => ({
  getTemplateStorage: () => ({ upload: mocks.upload }),
}));

import { upsertTemplate } from "./store";

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

const row = {
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
  thumbnailUrl: null,
  tileUrl: null,
  screenshotUrl: null,
  featured: false,
  status: "published",
  createdAt: new Date("2026-08-03T00:00:00.000Z"),
  updatedAt: new Date("2026-08-03T00:00:00.000Z"),
  publishedAt: new Date("2026-08-03T00:00:00.000Z"),
};

const input = {
  id: "kids",
  name: "Kids",
  family: "education" as const,
  accent: "#F472B6",
  pitch: "Creative play",
  description: "Illustrated activities for children",
  mode: "light" as const,
  html: "<!doctype html><html><body>Kids</body></html>",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ url: row.storageUrl, size: row.size });
  mocks.onConflictDoUpdate.mockResolvedValue(undefined);
  mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.limit.mockReturnValue([row]);
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.select.mockReturnValue({ from: mocks.from });
});

function conflictVisualMetadata(): unknown {
  const config = mocks.onConflictDoUpdate.mock.calls[0]?.[0];
  return config?.set.visualMetadata;
}

describe("upsertTemplate visual metadata", () => {
  it("retains the stored JSONB value when an older upload omits metadata", async () => {
    const record = await upsertTemplate(input);

    expect(conflictVisualMetadata()).toBe(templates.visualMetadata);
    expect(record.visualMetadata).toEqual(REVIEWED);
  });

  it("clears the JSONB value when metadata is explicitly null", async () => {
    await upsertTemplate({ ...input, visualMetadata: null });

    expect(conflictVisualMetadata()).toBeNull();
  });
});
