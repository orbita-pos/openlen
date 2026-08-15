import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { runOptionalImageTool, type OptionalImageToolDeps } from "./optional-image-tool";

const HTML = `<!doctype html><html><body>
<section data-openlen-edit-id="ol-hero-1" data-original-image-one>uno</section>
<section data-openlen-edit-id="ol-story-2" data-original-image-two>dos</section>
<section data-openlen-edit-id="ol-end-3" data-original-image-three>tres</section>
<section data-openlen-edit-id="ol-extra-4" data-original-image-four>cuatro</section>
</body></html>`;

const CANDIDATE: SafeCreativeCandidate = {
  html: HTML, title: "Marca",
  visualEngine: { route: "section_composition", templateId: null } as never,
  filled: true, appliedOps: 4, source: "deepseek",
};

const FIRST_SHA = "a".repeat(64);
const url = (sha: string) => `/api/projects/p/assets/${sha}.webp`;

function deps(over: Partial<OptionalImageToolDeps> = {}): OptionalImageToolDeps {
  return {
    resolve: async (intent) => ({ ok: true as const, url: url(intent.subject === "dos" ? "b".repeat(64) : FIRST_SHA), source: "curated" as const }),
    recordImage: vi.fn(),
    ...over,
  };
}

const REQUESTS = [
  { targetId: "ol-hero-1", subject: "uno" },
  { targetId: "ol-story-2", subject: "dos" },
];

describe("optional image tool", () => {
  it("applies a resolved image to its target", async () => {
    const result = await runOptionalImageTool({ projectId: "p", candidate: CANDIDATE, requests: [REQUESTS[0]] }, deps());
    expect(result.applied).toBe(true);
    expect(result.candidate.html).toContain(url(FIRST_SHA));
  });

  it("asks the asset boundary for an optional, non-identity image", async () => {
    const resolve = vi.fn(async (_intent: { required: boolean; identityBearing: boolean }) => ({ ok: true as const, url: url(FIRST_SHA), source: "curated" as const }));
    await runOptionalImageTool({ projectId: "p", candidate: CANDIDATE, requests: [REQUESTS[0]] }, deps({ resolve } as never));
    expect(resolve.mock.calls[0][0]).toMatchObject({ required: false, identityBearing: false });
  });

  it("keeps the existing candidate when image two fails after image one", async () => {
    const resolve = vi.fn(async (intent: { subject: string }) => (intent.subject === "dos"
      ? { ok: false as const, code: "provider" as const }
      : { ok: true as const, url: url(FIRST_SHA), source: "curated" as const }));
    const result = await runOptionalImageTool({ projectId: "p", candidate: CANDIDATE, requests: REQUESTS }, deps({ resolve }));
    expect(result.candidate.html).toContain(url(FIRST_SHA));
    expect(result.candidate.html).toContain("data-original-image-two");
    expect(result.applied).toBe(true);
  });

  it("returns the untouched candidate when every image fails", async () => {
    const result = await runOptionalImageTool(
      { projectId: "p", candidate: CANDIDATE, requests: REQUESTS },
      deps({ resolve: async () => ({ ok: false, code: "provider" }) }),
    );
    expect(result.applied).toBe(false);
    expect(result.candidate).toEqual(CANDIDATE);
  });

  it("survives a resolver that throws", async () => {
    const result = await runOptionalImageTool(
      { projectId: "p", candidate: CANDIDATE, requests: [REQUESTS[0]] },
      deps({ resolve: async () => { throw new Error("network"); } }),
    );
    expect(result.applied).toBe(false);
    expect(result.candidate).toEqual(CANDIDATE);
  });

  it("never resolves more than three images for one page", async () => {
    const resolve = vi.fn(async () => ({ ok: true as const, url: url(FIRST_SHA), source: "curated" as const }));
    await runOptionalImageTool({
      projectId: "p",
      candidate: CANDIDATE,
      requests: [
        { targetId: "ol-hero-1", subject: "uno" },
        { targetId: "ol-story-2", subject: "dos" },
        { targetId: "ol-end-3", subject: "tres" },
        { targetId: "ol-extra-4", subject: "cuatro" },
      ],
    }, deps({ resolve }));
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("skips a request whose DOM target does not exist", async () => {
    const resolve = vi.fn(async () => ({ ok: true as const, url: url(FIRST_SHA), source: "curated" as const }));
    const result = await runOptionalImageTool(
      { projectId: "p", candidate: CANDIDATE, requests: [{ targetId: "ol-ghost-9", subject: "uno" }] },
      deps({ resolve }),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(result.candidate).toEqual(CANDIDATE);
  });

  it("refuses a resolved url that is not a validated OpenLen asset", async () => {
    const result = await runOptionalImageTool(
      { projectId: "p", candidate: CANDIDATE, requests: [REQUESTS[0]] },
      deps({ resolve: async () => ({ ok: true, url: "https://evil.com/x.png", source: "generated" }) }),
    );
    expect(result.applied).toBe(false);
    expect(result.candidate).toEqual(CANDIDATE);
  });

  it("records a redacted image trace that carries no page bytes", async () => {
    const recordImage = vi.fn();
    await runOptionalImageTool({ projectId: "p", candidate: CANDIDATE, requests: [REQUESTS[0]] }, deps({ recordImage }));
    expect(recordImage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(recordImage.mock.calls[0])).not.toContain("<!doctype");
  });
});
