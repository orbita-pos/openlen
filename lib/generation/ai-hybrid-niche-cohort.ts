import { CreativeDirectionSchema, type CreativeDirection } from "./creative-contracts";
import { IntentAnalysisSchema, type IntentAnalysis } from "./contracts";
import type { CanonicalSectionRole } from "./structural-taxonomy";
import type { SectionType } from "@/lib/sections/types";

export interface AiHybridNicheCase {
  readonly id: "kids-coloring" | "horror-experience" | "comedy-club" | "video-game-launch" | "school-website" | "cooking-publication" | "physical-product-sale";
  readonly brief: string;
  readonly intent: IntentAnalysis;
  readonly expectedRoles: readonly CanonicalSectionRole[];
  readonly expectedComponents: readonly SectionType[];
  readonly expectedCreativeDirection: CreativeDirection;
  readonly requiredVisualSignals: readonly string[];
  readonly forbiddenVisualSignals: readonly string[];
  readonly forbiddenResidues: readonly string[];
}

const PALETTES = {
  coloring: { background: "#FFF7FC", surface: "#FFFFFF", surfaceAlt: "#FDE3F1", foreground: "#33213B", foregroundMuted: "#725E79", accent: "#B4236A", accentInk: "#FFFFFF", border: "#F3B6D4" },
  horror: { background: "#09090B", surface: "#151318", surfaceAlt: "#241A21", foreground: "#F7F1ED", foregroundMuted: "#B8A9AC", accent: "#B91C35", accentInk: "#FFFFFF", border: "#443038" },
  comedy: { background: "#FFF8E8", surface: "#FFFFFF", surfaceAlt: "#FFE39A", foreground: "#2D2018", foregroundMuted: "#786453", accent: "#C93413", accentInk: "#FFFFFF", border: "#F1BE74" },
  game: { background: "#080D1A", surface: "#111A2E", surfaceAlt: "#1B2950", foreground: "#F0F5FF", foregroundMuted: "#A8B8D5", accent: "#6342D8", accentInk: "#FFFFFF", border: "#33436B" },
  school: { background: "#F5FAFF", surface: "#FFFFFF", surfaceAlt: "#E1F0FF", foreground: "#17324D", foregroundMuted: "#5E7488", accent: "#1769AA", accentInk: "#FFFFFF", border: "#BED7EA" },
  cooking: { background: "#FFF8ED", surface: "#FFFFFF", surfaceAlt: "#F3E2C8", foreground: "#38261D", foregroundMuted: "#765E50", accent: "#A8452B", accentInk: "#FFFFFF", border: "#E8C8A9" },
  product: { background: "#F6F3EE", surface: "#FFFFFF", surfaceAlt: "#E8E2D9", foreground: "#282521", foregroundMuted: "#6E6860", accent: "#246B58", accentInk: "#FFFFFF", border: "#D0C8BD" },
} as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function intent(input: {
  siteType: string;
  sections: CanonicalSectionRole[];
  actions: string[];
  contentModel: string;
  audience: string;
  ageRange: string;
  secondary: string[];
  domains: string[];
  emotionalGoals: string[];
  required: string[];
  forbidden: string[];
}): IntentAnalysis {
  return IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0",
    language: "es",
    functional: { siteType: input.siteType, requiredSections: input.sections, primaryActions: input.actions, contentModel: input.contentModel },
    audience: { primary: input.audience, ageRange: input.ageRange, secondary: input.secondary },
    domains: input.domains,
    emotionalGoals: input.emotionalGoals,
    requiredVisualSignals: input.required,
    forbiddenVisualSignals: input.forbidden,
    explicitConstraints: [],
    ambiguities: [],
    confidence: 0.97,
  });
}

function direction(input: {
  mode: CreativeDirection["mode"];
  archetype: string;
  tone: string[];
  palette: CreativeDirection["palette"];
  display: CreativeDirection["typography"]["display"];
  body: CreativeDirection["typography"]["body"];
  radius: CreativeDirection["geometry"]["radius"];
  radiusScale: CreativeDirection["geometry"]["radiusScale"];
  strategy: CreativeDirection["imagery"]["strategy"];
  artDirection: string;
  subjects: string[];
  required: string[];
  forbidden: string[];
}): CreativeDirection {
  return CreativeDirectionSchema.parse({
    schemaVersion: "creative-direction/1.0",
    mode: input.mode,
    visualArchetype: input.archetype,
    emotionalTone: input.tone,
    palette: input.palette,
    typography: { display: input.display, body: input.body, mono: null, scale: "expressive" },
    geometry: { radius: input.radius, radiusScale: input.radiusScale, spacingScale: 1.15, density: "low_medium" },
    imagery: { strategy: input.strategy, artDirection: input.artDirection, subjects: input.subjects, avoid: input.forbidden },
    iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: input.radius === "square" ? "square" : "round" },
    componentTreatment: { cards: "layered_story_cards", buttons: "high_contrast_primary", navigation: "minimal_contextual_navigation", sections: "distinctive_editorial_rhythm" },
    requiredVisualSignals: input.required,
    forbiddenVisualSignals: input.forbidden,
  });
}

function nicheCase(input: Omit<AiHybridNicheCase, "intent" | "expectedCreativeDirection"> & {
  intent: Parameters<typeof intent>[0];
  direction: Parameters<typeof direction>[0];
}): AiHybridNicheCase {
  return deepFreeze({
    id: input.id,
    brief: input.brief,
    intent: intent(input.intent),
    expectedRoles: [...input.expectedRoles],
    expectedComponents: [...input.expectedComponents],
    expectedCreativeDirection: direction(input.direction),
    requiredVisualSignals: [...input.requiredVisualSignals],
    forbiddenVisualSignals: [...input.forbiddenVisualSignals],
    forbiddenResidues: [...input.forbiddenResidues],
  });
}

export const AI_HYBRID_NICHE_CASES: readonly AiHybridNicheCase[] = Object.freeze([
  nicheCase({
    id: "kids-coloring",
    brief: "Mundo Pincel: un espacio infantil mágico para colorear, jugar minijuegos, leer cuentos y hacer actividades creativas.",
    intent: { siteType: "content_platform", sections: ["hero", "coloring_gallery", "minigames", "stories", "activities"], actions: ["start_coloring"], contentModel: "creative_activities", audience: "children", ageRange: "age_4_9", secondary: ["parents"], domains: ["creative_play"], emotionalGoals: ["playful", "magical", "welcoming"], required: ["hand_drawn_illustrations", "playful_color_blocks", "rounded_shapes"], forbidden: ["saas_dashboard", "course_progress_ui", "corporate_photography"] },
    expectedRoles: ["header", "hero", "coloring_gallery", "minigames", "stories", "activities", "footer"],
    expectedComponents: ["navbar", "hero", "gallery", "features", "features", "features", "footer"],
    direction: { mode: "light", archetype: "illustrated_activity_book", tone: ["playful", "magical", "welcoming"], palette: PALETTES.coloring, display: "rounded_playful", body: "friendly_high_legibility", radius: "extra_round", radiusScale: 1.75, strategy: "illustration_first", artDirection: "hand_drawn_coloring_world", subjects: ["friendly_creatures", "coloring_pages", "art_tools"], required: ["hand_drawn_illustrations", "playful_color_blocks", "rounded_shapes"], forbidden: ["saas_dashboard", "course_progress_ui", "corporate_photography"] },
    requiredVisualSignals: ["hand_drawn_illustrations", "playful_color_blocks", "rounded_shapes"],
    forbiddenVisualSignals: ["saas_dashboard", "course_progress_ui", "corporate_photography"],
    forbiddenResidues: ["Lyceum", "Python", "JavaScript", "cURL", "Common Core", "IB curriculum", "tutoring plan"],
  }),
  nicheCase({
    id: "horror-experience",
    brief: "Una experiencia de terror inmersiva y cinematográfica con historia, galería, fechas y venta de acceso.",
    intent: { siteType: "landing_page", sections: ["hero", "about", "gallery", "events", "call_to_action"], actions: ["book_experience"], contentModel: "immersive_experience", audience: "adults", ageRange: "adults_18_plus", secondary: ["horror_fans"], domains: ["horror_entertainment"], emotionalGoals: ["uneasy", "cinematic", "mysterious"], required: ["cinematic_darkness", "atmospheric_texture", "dramatic_typography"], forbidden: ["generic_game_ui", "saas_dark_mode"] },
    expectedRoles: ["header", "hero", "about", "gallery", "events", "call_to_action", "footer"],
    expectedComponents: ["navbar", "hero", "about", "gallery", "features", "cta", "footer"],
    direction: { mode: "dark", archetype: "cinematic_horror_poster", tone: ["uneasy", "cinematic", "mysterious"], palette: PALETTES.horror, display: "elegant_editorial", body: "friendly_high_legibility", radius: "soft", radiusScale: 1, strategy: "texture_first", artDirection: "grainy_cinematic_shadows", subjects: ["abandoned_corridors", "practical_light", "human_silhouettes"], required: ["cinematic_darkness", "atmospheric_texture", "dramatic_typography"], forbidden: ["generic_game_ui", "saas_dark_mode"] },
    requiredVisualSignals: ["cinematic_darkness", "atmospheric_texture", "dramatic_typography"], forbiddenVisualSignals: ["generic_game_ui", "saas_dark_mode"], forbiddenResidues: ["SaaS pricing", "API documentation"],
  }),
  nicheCase({
    id: "comedy-club",
    brief: "Club de comedia en vivo con cartelera, personalidad irreverente, reservaciones y contacto.",
    intent: { siteType: "business_presence", sections: ["hero", "events", "about", "booking", "contact"], actions: ["reserve_seat"], contentModel: "live_events", audience: "adults", ageRange: "adults_18_plus", secondary: ["comedy_fans"], domains: ["live_comedy"], emotionalGoals: ["energetic", "human", "irreverent"], required: ["performer_portraits", "punchy_type", "stage_energy"], forbidden: ["corporate_event_branding", "conference_agenda"] },
    expectedRoles: ["header", "hero", "events", "about", "booking", "contact", "footer"],
    expectedComponents: ["navbar", "hero", "features", "about", "contact", "contact", "footer"],
    direction: { mode: "cream", archetype: "live_comedy_marquee", tone: ["energetic", "human", "irreverent"], palette: PALETTES.comedy, display: "modern_geometric", body: "friendly_high_legibility", radius: "round", radiusScale: 1.75, strategy: "photo_first", artDirection: "flash_lit_stage_portraits", subjects: ["standup_performers", "audience_laughter", "club_marquee"], required: ["performer_portraits", "punchy_type", "stage_energy"], forbidden: ["corporate_event_branding", "conference_agenda"] },
    requiredVisualSignals: ["performer_portraits", "punchy_type", "stage_energy"], forbiddenVisualSignals: ["corporate_event_branding", "conference_agenda"], forbiddenResidues: ["enterprise summit", "quarterly report"],
  }),
  nicheCase({
    id: "video-game-launch",
    brief: "Lanzamiento de un videojuego de aventura con mecánicas, mundo, capturas y llamado a jugar.",
    intent: { siteType: "product_landing_page", sections: ["hero", "features", "how_it_works", "gallery", "call_to_action"], actions: ["wishlist_game"], contentModel: "game_launch", audience: "gamers", ageRange: "teen_and_adult", secondary: ["fans"], domains: ["video_games"], emotionalGoals: ["immersive", "interactive", "adventurous"], required: ["gameplay_screens", "world_building", "interactive_energy"], forbidden: ["developer_tool_ui", "documentation_layout"] },
    expectedRoles: ["header", "hero", "features", "how_it_works", "gallery", "call_to_action", "footer"],
    expectedComponents: ["navbar", "hero", "features", "how-it-works", "gallery", "cta", "footer"],
    direction: { mode: "dark", archetype: "immersive_game_launch", tone: ["immersive", "interactive", "adventurous"], palette: PALETTES.game, display: "modern_geometric", body: "friendly_high_legibility", radius: "soft", radiusScale: 1, strategy: "mixed", artDirection: "cinematic_gameplay_world", subjects: ["playable_heroes", "fantasy_landscapes", "gameplay_moments"], required: ["gameplay_screens", "world_building", "interactive_energy"], forbidden: ["developer_tool_ui", "documentation_layout"] },
    requiredVisualSignals: ["gameplay_screens", "world_building", "interactive_energy"], forbiddenVisualSignals: ["developer_tool_ui", "documentation_layout"], forbiddenResidues: ["API reference", "developer documentation"],
  }),
  nicheCase({
    id: "school-website",
    brief: "Sitio de una escuela para familias con programas, historia, eventos y contacto claro.",
    intent: { siteType: "educational_resource", sections: ["hero", "programs", "about", "events", "contact"], actions: ["schedule_visit"], contentModel: "school_information", audience: "parents", ageRange: "school_age_families", secondary: ["students", "educators"], domains: ["school_education"], emotionalGoals: ["trustworthy", "clear", "warm"], required: ["real_learning_spaces", "family_trust", "clear_information"], forbidden: ["adult_course_saas", "course_progress_ui"] },
    expectedRoles: ["header", "hero", "programs", "about", "events", "contact", "footer"],
    expectedComponents: ["navbar", "hero", "features", "about", "features", "contact", "footer"],
    direction: { mode: "light", archetype: "welcoming_school_community", tone: ["trustworthy", "clear", "warm"], palette: PALETTES.school, display: "friendly_high_legibility", body: "friendly_high_legibility", radius: "round", radiusScale: 1.75, strategy: "photo_first", artDirection: "documentary_school_life", subjects: ["students_learning", "teachers_guiding", "family_community"], required: ["real_learning_spaces", "family_trust", "clear_information"], forbidden: ["adult_course_saas", "course_progress_ui"] },
    requiredVisualSignals: ["real_learning_spaces", "family_trust", "clear_information"], forbiddenVisualSignals: ["adult_course_saas", "course_progress_ui"], forbiddenResidues: ["subscription dashboard", "course completion meter"],
  }),
  nicheCase({
    id: "cooking-publication",
    brief: "Publicación editorial de cocina con receta destacada, archivo de historias y newsletter.",
    intent: { siteType: "blog", sections: ["hero", "featured_content", "content_list", "newsletter"], actions: ["read_recipe"], contentModel: "culinary_publication", audience: "readers", ageRange: "general", secondary: ["home_cooks", "food_lovers"], domains: ["food_editorial"], emotionalGoals: ["sensory", "editorial", "appetizing"], required: ["ingredient_photography", "editorial_rhythm", "culinary_texture"], forbidden: ["generic_ecommerce_grid", "wellness_dashboard"] },
    expectedRoles: ["header", "hero", "featured_content", "content_list", "newsletter", "footer"],
    expectedComponents: ["navbar", "hero", "features", "features", "features", "footer"],
    direction: { mode: "cream", archetype: "sensory_culinary_journal", tone: ["sensory", "editorial", "appetizing"], palette: PALETTES.cooking, display: "editorial_warm", body: "friendly_high_legibility", radius: "soft", radiusScale: 1, strategy: "photo_first", artDirection: "natural_light_food_editorial", subjects: ["seasonal_dishes", "ingredients", "hands_cooking"], required: ["ingredient_photography", "editorial_rhythm", "culinary_texture"], forbidden: ["generic_ecommerce_grid", "wellness_dashboard"] },
    requiredVisualSignals: ["ingredient_photography", "editorial_rhythm", "culinary_texture"], forbiddenVisualSignals: ["generic_ecommerce_grid", "wellness_dashboard"], forbiddenResidues: ["checkout cart", "wellness plan"],
  }),
  nicheCase({
    id: "physical-product-sale",
    brief: "Página de venta de una lámpara física con detalle del producto, beneficios, reseñas, FAQ y compra.",
    intent: { siteType: "ecommerce", sections: ["hero", "products", "features", "testimonials", "faq", "call_to_action"], actions: ["buy_product"], contentModel: "physical_product", audience: "consumers", ageRange: "adults", secondary: ["homeowners"], domains: ["home_goods"], emotionalGoals: ["desirable", "trustworthy", "tactile"], required: ["product_closeups", "material_detail", "purchase_confidence"], forbidden: ["saas_dashboard", "abstract_software_mockup"] },
    expectedRoles: ["header", "hero", "products", "features", "testimonials", "faq", "call_to_action", "footer"],
    expectedComponents: ["navbar", "hero", "gallery", "features", "testimonials", "faq", "cta", "footer"],
    direction: { mode: "cream", archetype: "tactile_product_showcase", tone: ["desirable", "trustworthy", "tactile"], palette: PALETTES.product, display: "elegant_editorial", body: "friendly_high_legibility", radius: "soft", radiusScale: 1, strategy: "photo_first", artDirection: "studio_product_story", subjects: ["product_hero", "material_closeups", "product_in_use"], required: ["product_closeups", "material_detail", "purchase_confidence"], forbidden: ["saas_dashboard", "abstract_software_mockup"] },
    requiredVisualSignals: ["product_closeups", "material_detail", "purchase_confidence"], forbiddenVisualSignals: ["saas_dashboard", "abstract_software_mockup"], forbiddenResidues: ["SaaS dashboard", "API integration"],
  }),
]);
