import { describe, expect, it } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "./ai-hybrid-niche-cohort";
import { compileSkeletonIdentity } from "./creative-compiler";
import { buildDeterministicCreativeDirection } from "./deterministic-creative-direction";
import { buildSkeletonInventory } from "./skeleton-inventory";

const HTML = '<!doctype html><html><head><title>Fixture</title></head><body><main><section class="hero"><h1>Hello</h1></section><section><article class="card">Card</article></section></main></body></html>';

describe("buildDeterministicCreativeDirection", () => {
  it.each(AI_HYBRID_NICHE_CASES)("compiles the $id niche through the real visual compiler", (row) => {
    const inventory = buildSkeletonInventory(HTML, `niche-${row.id}`);
    const creative = buildDeterministicCreativeDirection(row.intent);

    const compiled = compileSkeletonIdentity({
      html: HTML,
      inventory,
      direction: creative.direction,
      plan: creative.plan,
    });

    expect(compiled, compiled.ok ? undefined : compiled.code).toMatchObject({ ok: true });
  });

  it("selects the illustrated activity-book identity for Mundo Pincel", () => {
    const row = AI_HYBRID_NICHE_CASES.find((candidate) => candidate.id === "kids-coloring");
    expect(row).toBeDefined();
    const creative = buildDeterministicCreativeDirection(row!.intent);
    expect(creative.direction).toMatchObject({
      visualArchetype: "illustrated_activity_book",
      typography: { display: "rounded_playful" },
      geometry: { radius: "extra_round" },
      imagery: { strategy: "illustration_first" },
    });
  });
});
