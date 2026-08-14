import { describe, expect, it } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import { buildDeterministicIntent, buildDeterministicPageCopy, matchDeterministicNiche } from "./deterministic-page-input";

describe("deterministic page input", () => {
  it.each(AI_HYBRID_NICHE_CASES)("keeps $id in its reviewed niche", (row) => {
    const matched = matchDeterministicNiche(row.brief);
    const intent = buildDeterministicIntent(row.brief);
    const copy = buildDeterministicPageCopy(row.brief, intent);

    expect(matched.candidate.id).toBe(row.id);
    expect(matched.score).toBeGreaterThan(0);
    expect(intent).toEqual(row.intent);
    expect(copy.business_name).toBeTruthy();
    expect(copy.features.length).toBeGreaterThanOrEqual(3);
    expect(copy.pitch).toContain(row.brief.slice(0, 40));
  });

  it("extracts the explicit Mundo Pincel name from the full brief", () => {
    const brief = 'Crea una plataforma infantil llamada “Mundo Pincel” para niñas y niños con páginas para colorear, minijuegos y cuentos.';
    const intent = buildDeterministicIntent(brief);
    expect(matchDeterministicNiche(brief).candidate.id).toBe("kids-coloring");
    expect(buildDeterministicPageCopy(brief, intent).business_name).toBe("Mundo Pincel");
  });

  it.each([
    ['A brochure site called "Northwind Nook" for a zymurgy atelier.', "en", "Northwind Nook"],
    ['Crea llamada "Taller Bruma": zymurgy artesanal.', "es", "Taller Bruma"],
  ])("uses a conservative %s fallback without borrowing a reviewed niche", (brief, language, name) => {
    const matched = matchDeterministicNiche(brief);
    const intent = buildDeterministicIntent(brief);
    const copy = buildDeterministicPageCopy(brief, intent);

    expect(matched.score).toBe(0);
    expect(intent).toMatchObject({
      language,
      functional: { requiredSections: ["header", "hero", "features", "cta", "footer"] },
    });
    expect(copy.business_name).toBe(name);
  });
});
