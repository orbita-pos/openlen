import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { runCreativeGeneration, type CreativeGenerationDeps } from "./run-creative-generation";
import { SECTION_COMPOSITION_MANIFEST_VERSION } from "@/lib/generation/section-composition-contracts";

const BASELINE_HTML = "<!doctype html><html><body><section>baseline</section></body></html>";
const IMPROVED_HTML = "<!doctype html><html><body><section>improved</section></body></html>";

const VISUAL_ENGINE = { schemaVersion: "visual-engine-project/1.0", route: "section_composition", templateId: null } as never;

const BASELINE: SafeCreativeCandidate = {
  html: BASELINE_HTML, title: "Mundo Pincel", visualEngine: VISUAL_ENGINE,
  filled: true, appliedOps: 5, source: "baseline",
};
const IMPROVED: SafeCreativeCandidate = { ...BASELINE, html: IMPROVED_HTML, source: "deepseek" };

const INPUT = {
  projectId: "11111111-1111-4111-8111-111111111111",
  brief: "Una página de terror con estética VHS",
  profileData: { brand: { accent: "#000", logoUrl: null } } as never,
  records: [{ id: "hero-one", type: "hero" }] as never,
};

function deps(over: Partial<CreativeGenerationDeps> = {}): CreativeGenerationDeps {
  return {
    buildBaseline: async () => ({ ok: true, candidate: BASELINE, intent: { language: "es" } as never, copy: {} as never }),
    runCreativeSession: async () => ({ candidate: IMPROVED, changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished" }),
    runAdvisoryReview: async ({ candidate }) => ({ candidate, reviewed: true, repaired: false }),
    validateDelivery: (({ visualEngine }: { visualEngine: unknown }) => ({ ok: true, visualEngine })) as never,
    ...over,
  };
}

describe("creative generation orchestration", () => {
  it("delivers the improved candidate when every stage works", async () => {
    const result = await runCreativeGeneration(INPUT, deps());
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, degraded: false });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
    expect(result.ok && result.title).toBe("Mundo Pincel");
  });

  it.each([
    ["deepseek_missing_key", { stoppedBy: "provider" as const }],
    ["deepseek_timeout", { stoppedBy: "provider" as const }],
    ["deepseek_invalid_tool", { stoppedBy: "provider" as const }],
    ["deepseek_budget", { stoppedBy: "budget" as const }],
  ])("delivers lastKnownGood on %s", async (_name, over) => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: BASELINE, changed: false, acceptedMutations: 0, rejections: [], ...over }),
    }));
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
  });

  it("delivers lastKnownGood when the creative session throws outright", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => { throw new Error("transport exploded"); },
    }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
  });

  it.each(["qwen_timeout", "qwen_malformed", "qwen_reject"])("delivers the page on %s", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runAdvisoryReview: async ({ candidate }) => ({ candidate, reviewed: false, repaired: false }),
    }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
  });

  it("delivers the page when the advisory review throws", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runAdvisoryReview: async () => { throw new Error("qwen down"); },
    }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
  });

  it("fails only when no safe baseline can be built", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => ({ ok: false, code: "section_inventory_unavailable", detail: "section_fragment_stale" }),
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition", reasonCode: "section_inventory_unavailable" });
  });

  // The public reason is coarse on purpose; the journal must still say which
  // of a dozen catalog failures actually happened.
  it("records the composer's own reason, not the collapsed public one", async () => {
    const recordFailure = vi.fn();
    await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => ({ ok: false, code: "section_inventory_unavailable", detail: "section_fragment_stale" }),
      recordFailure,
    }));
    expect(recordFailure).toHaveBeenCalledWith("baseline", "section_fragment_stale");
  });

  it("fails when the baseline builder itself throws", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => { throw new Error("catalog down"); },
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition" });
  });

  it("falls back to the baseline when the improved candidate fails final delivery", async () => {
    const validateDelivery = vi.fn(({ html, visualEngine }: { html: string; visualEngine: unknown }) => (html === IMPROVED_HTML
      ? { ok: false as const, reasonCode: "invalid_composition_metadata" as const }
      : { ok: true as const, visualEngine }));
    const result = await runCreativeGeneration(INPUT, deps({ validateDelivery: validateDelivery as never }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
    expect(validateDelivery).toHaveBeenCalledTimes(2);
  });

  it("aborts only when both the improvement and the baseline fail delivery", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      validateDelivery: (() => ({ ok: false, reasonCode: "invalid_composition_metadata" })) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "delivery_gate", reasonCode: "invalid_composition_metadata" });
  });

  it("reports progress in the cutover order", async () => {
    const stages: string[] = [];
    await runCreativeGeneration({ ...INPUT, onStage: (stage) => stages.push(stage) }, deps());
    expect(stages).toEqual(["baseline", "creative", "review", "delivery_gate"]);
  });

  it("never lets a progress callback change delivery", async () => {
    const result = await runCreativeGeneration(
      { ...INPUT, onStage: () => { throw new Error("ui blew up"); } },
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  // A degraded stage is redacted telemetry, not a failure: recording it as a
  // failure would spend the request's single terminal outcome on a page that
  // shipped fine.
  it("records a degraded stage without touching the terminal failure channel", async () => {
    const recordFailure = vi.fn();
    const recordDegraded = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: BASELINE, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "provider" }),
      recordFailure,
      recordDegraded,
    }));
    expect(result.ok).toBe(true);
    expect(recordDegraded).toHaveBeenCalledWith("creative_session", "provider");
    expect(recordFailure).not.toHaveBeenCalled();
    expect(JSON.stringify(recordDegraded.mock.calls)).not.toContain("<!doctype");
  });

  it("still records a terminal failure when no candidate can be delivered", async () => {
    const recordFailure = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({
      validateDelivery: (() => ({ ok: false as const, reasonCode: "invalid_composition_metadata" as const })) as never,
      recordFailure,
    }));
    expect(result).toMatchObject({ ok: false, stage: "delivery_gate" });
    expect(recordFailure).toHaveBeenCalledWith("delivery_gate", "invalid_composition_metadata");
  });

  it("passes the baseline's own intent and copy into the creative session", async () => {
    const runCreativeSession = vi.fn(async (_input: { baseline: SafeCreativeCandidate; brief: string }) => ({ candidate: IMPROVED, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" as const }));
    await runCreativeGeneration(INPUT, deps({ runCreativeSession }));
    expect(runCreativeSession.mock.calls[0][0]).toMatchObject({ baseline: BASELINE, brief: INPUT.brief });
  });
});

describe("model palette adoption", () => {
  // The model redesigns with its own tokens while <html> keeps the direction's,
  // so a section it painted meets a library fragment reading --ol-* and the
  // seam shows. The theme drops to the model's values — but the delivery gate
  // compares sha256(html) against manifest.outputHash, so the bytes cannot move
  // without resealing.
  const THEMED = '<!doctype html><html class="dark" style="--ol-bg:#09090B"><head>'
    + "<style>:root{--bg:#070606}</style></head><body><section>improved</section></body></html>";
  const H = (c: string) => `sha256:${c.repeat(64)}`;
  // A real manifest: `sealAiCompositionOutput` re-parses it, so a stub shape
  // would only prove the fail-soft path.
  const MANIFEST = {
    schemaVersion: SECTION_COMPOSITION_MANIFEST_VERSION,
    intentHash: H("a"), creativeDirectionHash: H("b"), inventoryHash: H("c"),
    orderedRoles: ["hero"], selectedSectionIds: ["hero-one"], selectedContentHashes: ["d".repeat(12)],
    selectedSourceKinds: ["manual"], selectedSourceTemplateIds: [null],
    selectedSourceBandOrdinals: [null], selectedStructuralFingerprints: [H("e")],
    compatibilityRuleIds: ["section_component:hero"], outputHash: null, resultCode: "composed",
  };
  const themedEngine = { ...(VISUAL_ENGINE as object), compositionManifest: MANIFEST } as never;
  const themedCandidate: SafeCreativeCandidate = { ...IMPROVED, html: THEMED, visualEngine: themedEngine };

  it("drops the page theme to the palette the model painted with", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: themedCandidate, changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished" }),
    }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("--ol-bg:#070606");
  });

  it("reseals the manifest, or the gate discards the whole session in silence", async () => {
    // Without the reseal this delivers the BASELINE: hash mismatch → refused →
    // fall back → still reported ok. The redesign the user paid for, gone, and
    // nothing in the result says so.
    const { sha256 } = await import("@/lib/generation/content-hash");
    const validateDelivery = vi.fn(({ html, visualEngine }: { html: string; visualEngine: unknown }) => {
      const stamped = (visualEngine as { compositionManifest?: { outputHash?: string } })?.compositionManifest?.outputHash;
      return stamped === sha256(html)
        ? { ok: true as const, visualEngine }
        : { ok: false as const, reasonCode: "output_hash_mismatch" as const };
    }) as never;

    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({
        candidate: {
          ...themedCandidate,
          visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: { ...MANIFEST, outputHash: sha256(THEMED) } } as never,
        },
        changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished",
      }),
      validateDelivery,
    }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("--ol-bg:#070606");
    expect(result.ok && result.degraded).toBe(false);
  });

  it("keeps the candidate untouched when the model painted no palette", async () => {
    const recordDegraded = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({ recordDegraded }));

    expect(result.ok && result.html).toBe(IMPROVED_HTML);
    expect(recordDegraded).not.toHaveBeenCalledWith("delivery_gate", expect.anything());
  });
});
