import { describe, expect, it, vi } from "vitest";
import { runVisualEngine2BEvalCli, VISUAL_ENGINE_2B_AUTHORIZATION, visualEngine2BEnvironmentReady } from "@/scripts/visual-engine-2b-eval";
import { qualifyVisualEngine2BCohort } from "./visual-engine-2b-qualification";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";

function record(id: string, type: SectionType): SectionRecord {
  return { id, type, name: id, variantLabel: id, rootTag: "section", mode: "light", storageKey: id, storageUrl: `https://invalid/${id}`, contentHash: id.padEnd(12, "0").slice(0, 12), size: 1, designTokens: null, fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null, status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0) };
}
const records = ["navbar", "hero", "gallery", "how-it-works", "integrations", "pricing", "faq", "about", "contact", "footer"]
  .flatMap((type) => Array.from({ length: type === "contact" || type === "gallery" ? 2 : 1 }, (_, i) => record(`${type}-${i}`, type as SectionType)))
  .concat(Array.from({ length: 4 }, (_, i) => record(`features-${i}`, "features")));

async function fixture() {
  const qualified = await qualifyVisualEngine2BCohort({ loadPublishedSections: async () => records, commitSha: async () => "a".repeat(40) });
  const order: string[] = [];
  return { order, deps: {
    mode: "shadow",
    authorization: VISUAL_ENGINE_2B_AUTHORIZATION,
    budgetMicromxn: "20000000",
    perCaseMaximumMicromxn: 1_000_000,
    rateCardReady: true,
    getQuota: vi.fn(async () => { order.push("quota"); return { limit: 15, used: 0, existingRuns: 0 }; }),
    getCommitSha: vi.fn(async () => { order.push("head"); return "a".repeat(40); }),
    readQualification: vi.fn(async () => { order.push("qualification"); return qualified.manifest; }),
    loadPublishedSections: vi.fn(async () => { order.push("inventory"); return records; }),
    runCase: vi.fn(async (row: { id: string; expectedFallback?: string }) => {
      order.push(`run:${row.id}`);
      return row.expectedFallback === "unsupported_section_role" ? "unsupported_section_role" as const : "composed" as const;
    }),
    log: vi.fn(),
  } };
}

describe("runVisualEngine2BEvalCli", () => {
  it("closes before production dependencies when authorization or cost configuration is absent", () => {
    expect(visualEngine2BEnvironmentReady({ OPENLEN_VISUAL_ENGINE: "shadow" })).toBe(false);
  });
  it("runs exactly the 13 supported cases sequentially only after every gate", async () => {
    const state = await fixture();
    const result = await runVisualEngine2BEvalCli(state.deps);
    expect(result).toEqual({ ok: true, cases: 15, supported: 13, typedFallback: 2 });
    expect(state.deps.runCase).toHaveBeenCalledTimes(15);
    const firstRun = state.order.findIndex((item) => item.startsWith("run:"));
    expect(state.order.slice(0, firstRun)).toEqual(["quota", "head", "qualification", "inventory", "head", "quota"]);
  });

  it.each([
    ["authorization", undefined, "invalid_environment"],
    ["mode", "composition", "invalid_environment"],
    ["rateCardReady", false, "invalid_environment"],
    ["budgetMicromxn", "20000001", "evaluation_failed"],
  ] as const)("rejects invalid %s before a paid case", async (key, value, code) => {
    const state = await fixture();
    Object.assign(state.deps, { [key]: value });
    expect(await runVisualEngine2BEvalCli(state.deps)).toEqual({ ok: false, code });
    expect(state.deps.runCase).not.toHaveBeenCalled();
  });

  it("rejects stale qualification and a changed post-check quota", async () => {
    const stale = await fixture();
    stale.deps.getCommitSha.mockResolvedValue("b".repeat(40));
    expect(await runVisualEngine2BEvalCli(stale.deps)).toEqual({ ok: false, code: "qualification_stale" });
    expect(stale.deps.runCase).not.toHaveBeenCalled();

    const quota = await fixture();
    quota.deps.getQuota.mockResolvedValueOnce({ limit: 15, used: 0, existingRuns: 0 }).mockResolvedValueOnce({ limit: 15, used: 1, existingRuns: 1 });
    expect(await runVisualEngine2BEvalCli(quota.deps)).toEqual({ ok: false, code: "preflight_stale" });
    expect(quota.deps.runCase).not.toHaveBeenCalled();
  });

  it("stops without retry when a case returns the wrong typed result", async () => {
    const state = await fixture();
    state.deps.runCase.mockResolvedValueOnce("unsupported_section_role");
    expect(await runVisualEngine2BEvalCli(state.deps)).toEqual({ ok: false, code: "evaluation_failed" });
    expect(state.deps.runCase).toHaveBeenCalledTimes(1);
  });
});
