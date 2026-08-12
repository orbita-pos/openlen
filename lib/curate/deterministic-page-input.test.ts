import { describe, expect, it } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import { buildDeterministicIntent, buildDeterministicPageCopy, matchDeterministicNiche } from "./deterministic-page-input";

describe("deterministic page input", () => {
  it.each(AI_HYBRID_NICHE_CASES)("keeps $id in its reviewed niche", (row) => {
    const matched = matchDeterministicNiche(row.brief);
    const intent = buildDeterministicIntent(row.brief);
    const copy = buildDeterministicPageCopy(row.brief, intent);

    expect(matched.id).toBe(row.id);
    expect(intent).toEqual(row.intent);
    expect(copy.business_name).toBeTruthy();
    expect(copy.features.length).toBeGreaterThanOrEqual(3);
    expect(copy.pitch).toContain(row.brief.slice(0, 40));
  });

  it("extracts the explicit Mundo Pincel name from the full brief", () => {
    const brief = 'Crea una plataforma infantil llamada “Mundo Pincel” para niñas y niños con páginas para colorear, minijuegos y cuentos.';
    const intent = buildDeterministicIntent(brief);
    expect(matchDeterministicNiche(brief).id).toBe("kids-coloring");
    expect(buildDeterministicPageCopy(brief, intent).business_name).toBe("Mundo Pincel");
  });
});
