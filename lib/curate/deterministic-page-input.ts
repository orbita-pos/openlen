import { AI_HYBRID_NICHE_CASES, type AiHybridNicheCase } from "@/lib/generation/ai-hybrid-niche-cohort";
import { IntentAnalysisSchema, type IntentAnalysis } from "@/lib/generation/contracts";
import { coerceBusinessData, type ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { CanonicalSectionRole } from "@/lib/generation/structural-taxonomy";
import { sectionRoleLabel } from "./section-role-labels";

const NAMES: Record<AiHybridNicheCase["id"], string> = {
  "kids-coloring": "Mundo Pincel",
  "horror-experience": "El Umbral",
  "comedy-club": "Risa Brava",
  "video-game-launch": "Eclipse Vale",
  "school-website": "Colegio Horizonte",
  "cooking-publication": "Mesa Viva",
  "physical-product-sale": "Lumen Uno",
};

// Filler words match every cohort row, so without this a brief about watch
// repair scores against kids-coloring and inherits its whole intent.
const SCORE_STOPWORDS = new Set([
  "para", "crea", "crear", "sitio", "pagina", "paginas", "web", "necesito", "quiero", "una", "uno",
  "con", "los", "las", "del", "por", "que", "mas", "sus", "este", "esta", "mi", "the", "and", "for",
  "with", "that", "from", "your", "build", "make", "create", "landing", "page", "site", "new", "about",
]);

function tokens(value: string): Set<string> {
  return new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !SCORE_STOPWORDS.has(word)));
}

function score(brief: Set<string>, candidate: AiHybridNicheCase): number {
  const haystack = tokens([
    candidate.id,
    candidate.brief,
    candidate.intent.functional.siteType,
    candidate.intent.functional.contentModel,
    ...candidate.intent.domains,
    ...candidate.intent.emotionalGoals,
    ...candidate.intent.requiredVisualSignals,
  ].join(" "));
  let matches = 0;
  for (const word of brief) if (haystack.has(word)) matches += 1;
  return matches;
}

export function matchDeterministicNiche(brief: string): { candidate: AiHybridNicheCase; score: number } {
  const words = tokens(brief);
  const ranked = AI_HYBRID_NICHE_CASES
    .map((candidate, index) => ({ candidate, index, score: score(words, candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  return { candidate: ranked.candidate, score: ranked.score };
}

// Los acentos y la puntuación invertida son evidencia dura; la lista de
// palabras sola dejaba pasar "Clínica dental familiar en Coyoacán" como inglés.
const SPANISH_MARKS = /[áéíóúñÑü¿¡]/i;
const SPANISH_WORDS = /\b(?:para|crea|página|pagina|sitio|necesito|quiero|mi|una|con|los|las|del|nuestro|nuestra|somos|tenemos|vendemos|atendemos)\b/i;

/** El idioma es del brief, nunca de la ficha que se le parezca. Una página en
 *  español que dice `lang="en"` le da al lector de pantalla la voz equivocada y
 *  hace que el navegador ofrezca traducirla al idioma en el que ya está. */
function languageOf(brief: string): "es" | "en" {
  return SPANISH_MARKS.test(brief) || SPANISH_WORDS.test(brief) ? "es" : "en";
}

// A brief no reviewed niche covers gets a conservative generic intent. Borrowing
// the top cohort row at score 0 is how eval fixtures reached real pages.
export function buildDeterministicIntent(brief: string): IntentAnalysis {
  const language = languageOf(brief);
  const match = matchDeterministicNiche(brief);
  if (match.score > 0) {
    return match.candidate.intent.language === language
      ? match.candidate.intent
      : IntentAnalysisSchema.parse({ ...match.candidate.intent, language });
  }
  return IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0",
    language,
    functional: {
      siteType: "marketing",
      requiredSections: ["header", "hero", "features", "call_to_action", "footer"],
      primaryActions: [],
      contentModel: "landing_page",
    },
    audience: { primary: "general", secondary: [], ageRange: null },
    domains: ["general"],
    emotionalGoals: [],
    requiredVisualSignals: [],
    forbiddenVisualSignals: [],
    explicitConstraints: [],
    ambiguities: [],
    confidence: 0,
  });
}

function explicitName(brief: string): string | null {
  const match = /(?:llamad[ao]|called|named)\s+[“"']?([^.,;\n”"']{2,48})/i.exec(brief);
  return match?.[1]?.trim() ?? null;
}

const STOPWORDS = new Set([
  "para", "crea", "pagina", "sitio", "necesito", "quiero", "sobre", "como", "esta", "este",
  "build", "make", "create", "landing", "page", "site", "with", "that", "from", "your", "boutique",
]);

// Never name an unmatched brief after a cohort fixture — that is how "Mundo
// Pincel" would end up on a watch repair shop.
function titleFromBrief(brief: string, language: "es" | "en"): string {
  const words = brief
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  return words.length > 0 ? words.join(" ") : (language === "es" ? "Nuevo Proyecto" : "New Project");
}

/** What this business does, in its own words. The first clause of the brief is
 *  the user's description of themselves; a taxonomy slug is ours about someone
 *  else. Bounded so it stays a label, not a paragraph. */
function industryFromBrief(brief: string, language: "es" | "en"): string {
  const first = brief.trim().replace(/\s+/g, " ").split(/[.;]/)[0]?.trim() ?? "";
  if (first.length >= 3) return first.slice(0, 80);
  return language === "es" ? "Negocio" : "Business";
}

export function buildDeterministicPageCopy(
  brief: string,
  intent: IntentAnalysis,
): ExtractedBusinessData {
  const niche = matchDeterministicNiche(brief);
  const language = intent.language === "es" ? "es" : "en";
  // The reviewed name belongs to the cohort's OWN brief, not to anything that
  // merely scores against it. The overlap is loose enough that a coffee roaster
  // matches horror, and the whole sweep of 2026-08-16 shipped under borrowed
  // brands: a roaster, a dental clinic and a course page all called "El
  // Umbral", the SaaS "Lumen Uno", the design studio "Risa Brava". A page that
  // carries someone else's name is the same defect the from-template gate fixed
  // in the <head> that morning, one layer deeper — here it is the H1.
  const isFixtureBrief = brief.trim() === niche.candidate.brief.trim();
  const name = explicitName(brief) ?? (isFixtureBrief ? NAMES[niche.candidate.id] : titleFromBrief(brief, language));
  const roles = intent.functional.requiredSections.filter((role) => !["header", "footer"].includes(role));
  const pitch = brief.trim().replace(/\s+/g, " ").slice(0, 240);
  return coerceBusinessData({
    business_name: name,
    // NOT `intent.domains[0]`. The direction is chosen by nearest-neighbour
    // over seven fixed niches, so a coffee roaster's domain came out
    // "horror_entertainment" — a slug, in English, describing someone else's
    // business. The brief is the only honest source for what this one does.
    industry: industryFromBrief(brief, language),
    // The tagline used to be `"Una experiencia " + emotionalGoals`, which put
    // "uneasy, cinematic, mysterious" on that same coffee page. `emotionalGoals`
    // is `TaxonomyListSchema` — an OPEN set, any slug the model invents — so no
    // translation table can ever be complete for it and it has no business in
    // visible copy at all. Taxonomy drives the design; it never writes the text.
    ...(language === "es"
      ? { tagline_es: "Una experiencia clara y memorable" }
      : { tagline_en: "A clear and memorable experience" }),
    pitch,
    hero_keyword: name.split(/\s+/)[0],
    features: roles.slice(0, 6).map((role) => {
      const label = sectionRoleLabel(role as CanonicalSectionRole, language);
      return {
        title: label,
        desc: language === "es"
          ? `${label} de ${name}.`
          : `${label} at ${name}.`,
      };
    }),
    cta_primary: language === "es" ? "Comenzar" : "Get started",
    cta_secondary: language === "es" ? "Descubrir más" : "Learn more",
    language_detected: language,
  });
}
