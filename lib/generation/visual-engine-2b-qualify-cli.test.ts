import { describe, expect, it, vi } from "vitest";
import { runVisualEngine2BQualification } from "@/scripts/visual-engine-2b-qualify";
import { createHash } from "node:crypto";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";

function record(id: string, type: SectionType): SectionRecord {
  const html = `<section>${id}</section>`;
  const contentHash = createHash("sha256").update(html).digest("hex").slice(0, 12);
  return { id, type, name: id, variantLabel: id, rootTag: "section", mode: "light", storageKey: `sections/${id}-${contentHash}.html`, storageUrl: `https://invalid/${id}`,
    contentHash, size: html.length, designTokens: null, fonts: null, needsJs: false,
    hasPlaceholders: false, thumbnailUrl: null, status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0) };
}

const records = ["navbar", "hero", "gallery", "how-it-works", "integrations", "pricing", "faq", "about", "contact", "footer"]
  .flatMap((type) => Array.from({ length: type === "contact" || type === "gallery" ? 2 : 1 }, (_, i) => record(`${type}-${i}`, type as SectionType)))
  .concat(Array.from({ length: 4 }, (_, i) => record(`features-${i}`, "features")));

function fixture(commits = ["a".repeat(40), "a".repeat(40)]) {
  const writes: Array<{ path: string; value: unknown }> = [];
  return { writes, deps: {
    listPublishedSections: vi.fn(async () => records),
    getCommitSha: vi.fn(async () => commits.shift() ?? "a".repeat(40)),
    mkdir: vi.fn(async () => undefined),
    writeJsonAtomic: vi.fn(async (path: string, value: unknown) => { writes.push({ path, value }); }),
    log: vi.fn(),
  } };
}

describe("runVisualEngine2BQualification", () => {
  it("writes one redacted immutable qualification artifact", async () => {
    const state = fixture();
    const manifest = await runVisualEngine2BQualification(state.deps, "C:\\repo");
    expect(manifest.counts).toEqual({ total: 15, qualified: 13, typedFallback: 2 });
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].path).toMatch(/scratch[\\/]visual-engine-2b[\\/]qualification\.json$/);
    expect(JSON.stringify(state.writes[0].value)).not.toContain("storageUrl");
  });

  it("refuses a moving commit without writing", async () => {
    const state = fixture(["a".repeat(40), "b".repeat(40)]);
    await expect(runVisualEngine2BQualification(state.deps)).rejects.toMatchObject({ code: "commit_changed" });
    expect(state.deps.writeJsonAtomic).not.toHaveBeenCalled();
  });
});
