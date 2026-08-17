import { describe, expect, it } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import { CANONICAL_SECTION_ROLES } from "@/lib/generation/structural-taxonomy";
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

  // The schema validates slug shape, not the taxonomy, so an invented role
  // parses fine here and only dies later at plan time.
  it.each([UNKNOWN_ES, UNKNOWN_EN])("only asks for roles the planner can actually serve (%s)", (brief) => {
    const roles = buildDeterministicIntent(brief).functional.requiredSections;
    const canonical = new Set<string>(CANONICAL_SECTION_ROLES);
    expect(roles.filter((role) => !canonical.has(role))).toEqual([]);
  });

  it("still writes usable copy for a brief no cohort row covers", () => {
    const intent = buildDeterministicIntent(UNKNOWN_ES);
    const copy = buildDeterministicPageCopy(UNKNOWN_ES, intent);
    expect(copy.business_name).toBeTruthy();
    expect(copy.features.length).toBeGreaterThanOrEqual(1);
    expect(copy.pitch).toContain("relojes");
  });
});

describe("placeholder copy never speaks our vocabulary", () => {
  // Measured on the 10-page sweep of 2026-08-16. A coffee roaster shipped
  // "Una experiencia uneasy, cinematic, mysterious" as its tagline and six
  // identical cards titled "call to action" — `emotionalGoals` and the section
  // role slugs, in English, on a Spanish page. Placeholder copy exists to be
  // replaced by the fill; when the fill misses a slot the user reads whatever
  // is underneath, so what is underneath cannot be machine words.
  // El brief EXACTO que produjo el defecto. Uno más corto no empareja con
  // ningún nicho y cae en el fallback seguro, o sea que no probaría nada.
  const BRIEF = "Tostador de café de especialidad con tienda en línea. Vende grano de origen único de Chiapas y Veracruz, suscripción mensual y cursos de barista los sábados. Necesita catálogo de cafés con notas de cata y precio, cómo funciona la suscripción, la historia del tostador y envíos a todo México.";

  it("keeps the emotional-goal slugs out of the tagline", () => {
    const intent = buildDeterministicIntent(BRIEF);
    const copy = buildDeterministicPageCopy(BRIEF, intent);
    const tagline = `${copy.tagline_es ?? ""}${copy.tagline_en ?? ""}`;

    for (const goal of intent.emotionalGoals) {
      expect(tagline, `leaked ${goal}`).not.toContain(goal.replace(/_/g, " "));
    }
  });

  it("titles the cards in the reader's language", () => {
    const intent = buildDeterministicIntent(BRIEF);
    const copy = buildDeterministicPageCopy(BRIEF, intent);

    for (const feature of copy.features) {
      // No slug survives as a title: no underscores, and not a bare lowercase
      // English word pair like "call to action".
      expect(feature.title).not.toMatch(/_/);
      expect(feature.title[0]).toBe(feature.title[0]?.toUpperCase());
    }
  });

  it("does not publish a taxonomy slug as the business's industry", () => {
    const intent = buildDeterministicIntent(BRIEF);
    const copy = buildDeterministicPageCopy(BRIEF, intent);

    expect(copy.industry ?? "").not.toMatch(/_/);
  });
});

describe("a user's page is never named after a fixture", () => {
  // The most severe of the sweep's findings: all five free-brief pages shipped
  // carrying a cohort fixture's brand. A coffee roaster, a dental clinic and a
  // course sales page were all called "El Umbral"; the SaaS was "Lumen Uno" and
  // the design studio "Risa Brava".
  //
  // The comment above `titleFromBrief` already worried about this — "never name
  // an UNMATCHED brief after a cohort fixture" — but the matched path is the
  // common one, because the overlap that decides a match is loose enough that a
  // coffee roaster matches horror.
  const REAL = [
    ["Tostador de café de especialidad con tienda en línea. Vende grano de origen único de Chiapas y Veracruz, suscripción mensual y cursos de barista los sábados.", "cafetería"],
    ["Clínica dental en Monterrey, atención de familias, 14 años de experiencia. Servicios de limpieza, ortodoncia e implantes, con agendar cita por WhatsApp.", "clínica"],
    ["Estudio de diseño y marca de 6 personas en Guadalajara. Trabajo para restaurantes, hoteles y marcas de producto, con portafolio de casos reales.", "estudio"],
  ] as const;

  const FIXTURE_NAMES = ["Mundo Pincel", "El Umbral", "Risa Brava", "Eclipse Vale", "Colegio Horizonte", "Mesa Viva", "Lumen Uno"];

  it.each(REAL)("does not borrow a fixture's brand for %#", (brief) => {
    const copy = buildDeterministicPageCopy(brief, buildDeterministicIntent(brief));

    expect(FIXTURE_NAMES, `named after a fixture: ${copy.business_name}`)
      .not.toContain(copy.business_name);
    expect(copy.business_name).toBeTruthy();
  });

  it("still names the cohort's own brief, which is all the map is for", () => {
    // Only an EXACT fixture brief keeps the reviewed name. horror-experience
    // has no "llamada X" in its text, so this is the map's path and not
    // explicitName's.
    const horror = AI_HYBRID_NICHE_CASES.find((row) => row.id === "horror-experience")!;
    const copy = buildDeterministicPageCopy(horror.brief, buildDeterministicIntent(horror.brief));

    expect(copy.business_name).toBe("El Umbral");
  });
});

describe("el idioma sale del brief, no de la ficha que se le parece", () => {
  const language = (brief: string) => buildDeterministicIntent(brief).language;

  it.each([
    ["Clínica dental familiar en Coyoacán. Atendemos a niños y adultos: limpiezas y ortodoncia."],
    ["Tostador de café de especialidad. Vendemos grano fresco y damos catas los sábados."],
    ["¡Bienvenidos! Taller de reparación de relojes mecánicos con 20 años de oficio."],
  ])("lee español en %s", (brief) => {
    expect(language(brief)).toBe("es");
  });

  it.each([
    ["Build a landing page for my watch repair shop in Brooklyn."],
    ["A family dental clinic. We treat kids and adults: cleanings, braces, whitening."],
  ])("lee inglés en %s", (brief) => {
    expect(language(brief)).toBe("en");
  });

  it("no hereda el idioma de la ficha aunque el brief la haya emparejado", () => {
    // El mismo negocio, escrito en los dos idiomas: la ficha que gane el
    // solapamiento es la misma, y aun así cada página debe hablar lo suyo.
    const es = "Una plataforma infantil para colorear, jugar y crear historias, con minijuegos y cuentos ilustrados.";
    const en = "A kids platform for coloring, playing and creating stories, with minigames and illustrated tales.";
    expect(language(es)).toBe("es");
    expect(language(en)).toBe("en");
  });
});
