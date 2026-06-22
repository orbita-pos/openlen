// Pick ONE curated template's full-page screenshot to attach as the
// multimodal reference for a free-form /api/generate brief (Quality S2).
//
// Strategy (v1 — keyword bag-of-words, no embeddings):
//   1. Classify the brief into a TemplateFamily by scoring accent-folded
//      keyword stems (English + Spanish — briefs arrive in both).
//   2. Within the matched family, rank `featured` templates first, then take
//      the first published one that actually HAS a screenshot.
//   3. Fallback: Mirror (our highest-quality canonical reference).
//   4. Hard fallback: if even Mirror has no screenshot, return null and let
//      the caller skip the image.
//
// The classifier is split out (pure, no DB) so it can be smoke-tested
// offline — see scripts/templates/test-select-reference.ts.

import { getTemplate, listTemplates, type TemplateRecord } from "./store";
import type { TemplateFamily } from "./families";

const MIRROR_ID = "mirror";

// Keyword stems per family. Matching is accent-folded + lowercased; a
// single-word entry matches any brief token that STARTS WITH it (so
// "fotograf" catches "fotografía"/"fotógrafa"), a multi-word entry matches as
// a substring. Lists are deliberately broad and bilingual; precision comes
// from summing across keywords + the priority tiebreak below, not from any
// one term. This is the v1 the spec endorses — swap for embeddings later if
// classification quality demands it.
const FAMILY_KEYWORDS: Record<TemplateFamily, string[]> = {
  aerospace: [
    "aerospace", "aeroespacial", "space", "espacial", "rocket", "cohete",
    "satellite", "satelite", "launch", "lanzamiento", "orbit", "orbita",
    "spacecraft", "nave", "mars", "marte", "spaceflight", "starship", "lunar",
    "propulsion", "payload", "constellation", "astronaut", "astronauta",
  ],
  saas: [
    "saas", "dashboard", "analytic", "metric", "b2b", "platform", "workflow",
    "automat", "integrat", "api", "software", "productiv", "crm", "devtool",
    "observability", "monitor", "pipeline", "insight", "report", "kpi", "ops",
  ],
  portfolio: [
    "portfolio", "photograph", "fotograf", "designer", "disenador", "artist",
    "artista", "studio", "estudio", "creativ", "illustrat", "freelance",
    "showcase", "gallery", "galeria", "photoshoot", "director", "videograf",
  ],
  "food-beverage": [
    "restaurant", "restaurante", "cafe", "coffee", "cafeteria", "bistro",
    "trattoria", "pizzeria", "pizza", "kitchen", "cocina", "menu", "chef",
    "bakery", "panaderia", "brewery", "cerveceria", "wine", "vino", "dining",
    "food", "comida", "eatery", "taqueria", "sushi", "ramen", "barista",
  ],
  hospitality: [
    "hotel", "resort", "hostel", "hospitality", "bnb", "airbnb", "lodge",
    "retreat", "suites", "boutique hotel", "vacation rental", "guesthouse",
  ],
  agency: [
    "agency", "agencia", "consultanc", "consultor", "marketing", "branding",
    "creative agency", "design agency", "web agency", "digital agency", "studio",
  ],
  ecommerce: [
    "ecommerce", "e-commerce", "shop", "tienda", "store", "storefront",
    "product", "producto", "checkout", "dropship", "retail", "merch",
    "catalog", "catalogo", "sell online", "shopify", "dtc",
  ],
  wellness: [
    "fitness", "gym", "gimnasio", "yoga", "pilates", "workout", "wellness",
    "bienestar", "meditation", "meditacion", "nutrition", "nutricion",
    "trainer", "entrenador", "mindful", "spa", "wellbeing",
  ],
  fintech: [
    "fintech", "banking", "banco", "payment", "pago", "finance", "finanzas",
    "invest", "invertir", "wallet", "billetera", "lending", "loan", "prestamo",
    "insurance", "seguro", "neobank", "trading", "ledger", "payroll",
  ],
  podcast: [
    "podcast", "episode", "episodio", "audio show", "microphone", "rss feed",
    "spotify show", "listeners",
  ],
  event: [
    "conference", "conferencia", "event", "evento", "summit", "festival",
    "meetup", "workshop", "taller", "webinar", "expo", "hackathon", "lineup",
    "speakers", "agenda", "keynote",
  ],
  "real-estate": [
    "real estate", "realty", "inmobiliaria", "property", "propiedad",
    "listing", "apartment", "departamento", "house for", "home for", "broker",
    "realtor", "mortgage", "alquiler", "condo",
  ],
  architecture: [
    "architect", "architecture", "arquitect", "arquitectura", "building",
    "edificio", "construccion", "construction", "interior design", "interiorism",
    "urban", "urbanism", "facade", "structural", "blueprint", "studio",
    "prefab", "prefabricat", "modular", "cabin", "cabana", "casa", "home",
    "hogar", "vivienda", "tiny home", "adu", "dwelling",
  ],
  "technical-minimal": [
    "cli", "terminal", "infra", "kubernetes", "docker", "sdk", "command line",
    "self-hosted tool",
  ],
  editorial: [
    "magazine", "revista", "blog", "publication", "newsletter", "journal",
    "editorial", "essay", "article", "writer", "longform",
  ],
  commerce: ["marketplace", "vendor", "multi-vendor", "wholesale"],
  documentation: [
    "documentation", "docs", "api reference", "developer docs", "knowledge base",
  ],
  "ai-ml": [
    "ai", "artificial intelligence", "machine learning", "llm", "neural",
    "inference", "agent", "copilot", "chatbot", "generative", "model",
  ],
  "health-tech": [
    "healthtech", "telehealth", "telemedicine", "clinic", "clinica", "patient",
    "paciente", "medical", "medico", "healthcare", "ehr", "pharma", "salud",
  ],
  "pre-launch": [
    "waitlist", "coming soon", "prelaunch", "pre-launch", "early access",
    "launching soon", "notify me",
  ],
  climate: [
    "climate", "clima", "carbon", "sustainab", "sostenib", "renewable", "solar",
    "green energy", "emission", "cleantech", "environment",
  ],
  "mobile-app": [
    "mobile app", "ios app", "android app", "app store", "download the app",
    "aplicacion movil",
  ],
  education: [
    "course", "curso", "learning", "education", "educacion", "school",
    "escuela", "academy", "academia", "student", "estudiante", "tutor",
    "bootcamp", "lesson", "ensenar", "e-learning", "lms",
  ],
  creator: [
    "creator", "influencer", "youtuber", "streamer", "substack", "patreon",
    "membership", "audience", "monetize", "content creator",
  ],
  "open-source": [
    "open source", "opensource", "github", "oss", "contributors", "self-hosted",
    "foss",
  ],
  music: [
    "music", "musica", "band", "banda", "album", "song", "cancion", "tour",
    "concert", "concierto", "record label", "musician", "dj",
  ],
  gaming: [
    "game", "juego", "gaming", "gamer", "esports", "multiplayer", "indie game",
    "playable", "rpg",
  ],
  sports: [
    "sport", "deporte", "football", "futbol", "soccer", "mma", "ufc", "boxing",
    "boxeo", "fight", "pelea", "combat", "combate", "match", "partido", "team",
    "equipo", "league", "liga", "tournament", "torneo", "athlete", "atleta",
    "stadium", "estadio", "championship", "campeonato", "fixture", "matchday",
    "wrestling", "fighter", "luchador", "kickboxing", "octagon", "ring",
  ],
  "local-services": [
    "plumber", "plumbing", "electrician", "electricista", "cleaning", "limpieza",
    "landscaping", "contractor", "handyman", "hvac", "roofing", "local business",
    "salon", "barber", "peluqueria", "mechanic",
  ],
  nonprofit: [
    "nonprofit", "non-profit", "charity", "caridad", "ngo", "donate", "donacion",
    "fundraiser", "foundation", "fundacion", "volunteer", "voluntario",
  ],
  web3: [
    "web3", "crypto", "blockchain", "nft", "dao", "token", "defi", "ethereum",
    "mint", "smart contract", "staking",
  ],
  hardware: [
    "hardware", "device", "dispositivo", "gadget", "iot", "sensor", "robotics",
    "drone", "wearable", "electronics", "prototype",
  ],
  wedding: [
    "wedding", "boda", "bride", "novia", "groom", "novio", "engagement",
    "registry", "rsvp", "matrimonio", "save the date", "venue",
  ],
  travel: [
    "travel", "viaje", "trip", "tour", "tourism", "turismo", "destination",
    "destino", "flight", "vuelo", "adventure", "aventura", "itinerary", "explore",
  ],
  fashion: [
    "fashion", "moda", "apparel", "ropa", "clothing", "collection", "coleccion",
    "runway", "lookbook", "streetwear", "seasonal",
  ],
  photography: [
    "photography", "fotografia", "photographer", "fotografo", "photo", "foto",
    "portfolio", "portafolio", "editorial", "studio", "gallery", "galeria",
    "lookbook", "model", "modelo", "shoot",
  ],
  cinema: [
    "cinema", "cine", "film", "pelicula", "movie", "streaming", "stream",
    "video", "trailer", "reel", "episodes", "episodios", "series", "serie",
    "channel", "canal", "watch", "showcase", "production", "produccion",
    "documentary", "documental", "originals", "screening", "premiere", "estreno",
  ],
};

// Tiebreak order when families score equally — common, high-quality-template
// families win. Anything not listed sorts after these in declaration order.
const FAMILY_PRIORITY: TemplateFamily[] = [
  "saas", "portfolio", "food-beverage", "agency", "ecommerce", "fintech",
  "wellness", "ai-ml", "event", "real-estate", "podcast", "education",
  "creator", "hospitality", "fashion", "travel",
];

function stripDiacritics(s: string): string {
  // Drop Unicode combining marks (U+0300–U+036F) after NFD so "fotógrafa"
  // folds to "fotografa" (one token) rather than splitting on the accent.
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue;
    out += ch;
  }
  return out;
}

function normalize(s: string): string {
  return stripDiacritics(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countMatches(norm: string, tokens: string[], keyword: string): number {
  if (keyword.includes(" ")) {
    // Phrase — count substring occurrences.
    let count = 0;
    let from = 0;
    for (;;) {
      const idx = norm.indexOf(keyword, from);
      if (idx === -1) break;
      count++;
      from = idx + keyword.length;
    }
    return count;
  }
  // Single token — prefix match so stems catch inflections.
  return tokens.filter((t) => t.startsWith(keyword)).length;
}

export interface BriefClassification {
  family: TemplateFamily | null;
  score: number;
  /** Top families by score (desc), for debugging the smoke test. */
  ranking: { family: TemplateFamily; score: number }[];
}

/** Pure brief → family classifier. No DB. Returns null family when nothing
 *  scores above zero. */
export function classifyBriefFamily(brief: string): BriefClassification {
  const norm = normalize(brief);
  const tokens = norm.length > 0 ? norm.split(" ") : [];

  const scored: { family: TemplateFamily; score: number }[] = [];
  for (const family of Object.keys(FAMILY_KEYWORDS) as TemplateFamily[]) {
    let score = 0;
    for (const kw of FAMILY_KEYWORDS[family]) {
      score += countMatches(norm, tokens, normalize(kw));
    }
    if (score > 0) scored.push({ family, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = FAMILY_PRIORITY.indexOf(a.family);
    const pb = FAMILY_PRIORITY.indexOf(b.family);
    return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
  });

  return {
    family: scored[0]?.family ?? null,
    score: scored[0]?.score ?? 0,
    ranking: scored.slice(0, 5),
  };
}

export interface ReferenceTemplate {
  id: string;
  screenshotUrl: string;
  family: TemplateFamily;
}

/** Rank `featured` first, then return the first record that actually has a
 *  screenshot (we can only attach one that's been captured). */
function pickWithScreenshot(records: TemplateRecord[]): TemplateRecord | null {
  const ranked = [...records].sort((a, b) => Number(b.featured) - Number(a.featured));
  return ranked.find((t) => !!t.screenshotUrl) ?? null;
}

export async function selectReferenceTemplate(
  brief: string,
): Promise<ReferenceTemplate | null> {
  const { family } = classifyBriefFamily(brief);

  if (family) {
    const inFamily = await listTemplates({ family });
    const pick = pickWithScreenshot(inFamily);
    if (pick?.screenshotUrl) {
      return { id: pick.id, screenshotUrl: pick.screenshotUrl, family: pick.family };
    }
  }

  // Fallback: Mirror — the canonical highest-quality reference.
  const mirror = await getTemplate(MIRROR_ID);
  if (mirror?.screenshotUrl) {
    return { id: mirror.id, screenshotUrl: mirror.screenshotUrl, family: mirror.family };
  }

  // Hard fallback: no usable reference. Caller skips the image.
  // eslint-disable-next-line no-console
  console.warn(
    `[select-reference] no reference screenshot available (family=${family ?? "none"}, mirror screenshot missing) — generating without a vision reference`,
  );
  return null;
}
