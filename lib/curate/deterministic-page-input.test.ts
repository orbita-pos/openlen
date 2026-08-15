import { describe, expect, it } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import { buildDeterministicIntent, buildDeterministicPageCopy, matchDeterministicNiche } from "./deterministic-page-input";

const UNKNOWN_ES = "Necesito un sitio para mi taller de restauración de relojes mecánicos de bolsillo";
const UNKNOWN_EN = "Build a landing page for a boutique typewriter repair bench";

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

  it("extracts an explicit English name", () => {
    const brief = 'Build a site called "Tick & Bolt" for a typewriter repair bench';
    expect(buildDeterministicPageCopy(brief, buildDeterministicIntent(brief)).business_name).toBe("Tick & Bolt");
  });

  it.each([UNKNOWN_ES, UNKNOWN_EN])("never borrows a zero-score cohort row as truth (%s)", (brief) => {
    expect(matchDeterministicNiche(brief).score).toBe(0);
    const intent = buildDeterministicIntent(brief);
    expect(AI_HYBRID_NICHE_CASES.some((row) => row.intent.functional.siteType === intent.functional.siteType
      && row.intent.domains.join() === intent.domains.join())).toBe(false);
    expect(intent.domains).toEqual(["general"]);
    expect(intent.confidence).toBe(0);
    expect(intent.functional.contentModel).toBe("landing_page");
  });

  it.each([
    [UNKNOWN_ES, "es"],
    [UNKNOWN_EN, "en"],
  ] as const)("detects the brief language without a cohort match (%s)", (brief, language) => {
    expect(buildDeterministicIntent(brief).language).toBe(language);
  });

  it.each([UNKNOWN_ES, UNKNOWN_EN])("still guarantees hero, one content role and footer (%s)", (brief) => {
    const roles = buildDeterministicIntent(brief).functional.requiredSections;
    expect(roles).toContain("hero");
    expect(roles).toContain("footer");
    expect(roles.filter((role) => !["header", "hero", "footer"].includes(role)).length).toBeGreaterThanOrEqual(1);
  });

  it("still writes usable copy for a brief no cohort row covers", () => {
    const intent = buildDeterministicIntent(UNKNOWN_ES);
    const copy = buildDeterministicPageCopy(UNKNOWN_ES, intent);
    expect(copy.business_name).toBeTruthy();
    expect(copy.features.length).toBeGreaterThanOrEqual(1);
    expect(copy.pitch).toContain("relojes");
  });
});
