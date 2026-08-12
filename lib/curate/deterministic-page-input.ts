import { AI_HYBRID_NICHE_CASES, type AiHybridNicheCase } from "@/lib/generation/ai-hybrid-niche-cohort";
import type { IntentAnalysis } from "@/lib/generation/contracts";
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

function tokens(value: string): Set<string> {
  return new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3));
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

export function matchDeterministicNiche(brief: string): AiHybridNicheCase {
  const words = tokens(brief);
  return AI_HYBRID_NICHE_CASES
    .map((candidate, index) => ({ candidate, index, score: score(words, candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0].candidate;
}

export function buildDeterministicIntent(brief: string): IntentAnalysis {
  return matchDeterministicNiche(brief).intent;
}

function explicitName(brief: string): string | null {
  const match = /(?:llamad[ao]|called|named)\s+[“"']?([^.,;\n”"']{2,48})/i.exec(brief);
  return match?.[1]?.trim() ?? null;
}

export function buildDeterministicPageCopy(
  brief: string,
  intent: IntentAnalysis,
): ExtractedBusinessData {
  const niche = matchDeterministicNiche(brief);
  const language = intent.language === "es" ? "es" : "en";
  const name = explicitName(brief) ?? NAMES[niche.id];
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
