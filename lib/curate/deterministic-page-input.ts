import { AI_HYBRID_NICHE_CASES, type AiHybridNicheCase } from "@/lib/generation/ai-hybrid-niche-cohort";
import { IntentAnalysisSchema, type IntentAnalysis } from "@/lib/generation/contracts";
import { coerceBusinessData, type ExtractedBusinessData } from "@/lib/style-match/autofill/types";

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

const SPANISH = /\b(?:para|crea|página|pagina|sitio|necesito|quiero|mi|una|con)\b/i;

// A brief no reviewed niche covers gets a conservative generic intent. Borrowing
// the top cohort row at score 0 is how eval fixtures reached real pages.
export function buildDeterministicIntent(brief: string): IntentAnalysis {
  const match = matchDeterministicNiche(brief);
  if (match.score > 0) return match.candidate.intent;
  return IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0",
    language: SPANISH.test(brief) ? "es" : "en",
    functional: {
      siteType: "marketing",
      requiredSections: ["header", "hero", "features", "cta", "footer"],
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

export function buildDeterministicPageCopy(
  brief: string,
  intent: IntentAnalysis,
): ExtractedBusinessData {
  const niche = matchDeterministicNiche(brief);
  const language = intent.language === "es" ? "es" : "en";
  const name = explicitName(brief) ?? (niche.score > 0 ? NAMES[niche.candidate.id] : titleFromBrief(brief, language));
  const roles = intent.functional.requiredSections.filter((role) => !["header", "footer"].includes(role));
  const tone = intent.emotionalGoals.slice(0, 3).join(", ").replace(/_/g, " ");
  const pitch = brief.trim().replace(/\s+/g, " ").slice(0, 240);
  return coerceBusinessData({
    business_name: name,
    industry: intent.domains[0] ?? intent.functional.siteType,
    ...(language === "es"
      ? { tagline_es: `Una experiencia ${tone || "clara y memorable"}` }
      : { tagline_en: `A ${tone || "clear and memorable"} experience` }),
    pitch,
    hero_keyword: name.split(/\s+/)[0],
    features: roles.slice(0, 6).map((role) => ({
      title: role.replace(/_/g, " "),
      desc: language === "es"
        ? `Descubre ${role.replace(/_/g, " ")} dentro de ${name}.`
        : `Explore ${role.replace(/_/g, " ")} inside ${name}.`,
    })),
    cta_primary: language === "es" ? "Comenzar" : "Get started",
    cta_secondary: language === "es" ? "Descubrir más" : "Learn more",
    language_detected: language,
  });
}
