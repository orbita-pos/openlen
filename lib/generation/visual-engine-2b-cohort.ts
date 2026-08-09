import { IntentAnalysisSchema, type IntentAnalysis } from "./contracts";
import type { CanonicalSectionRole } from "./structural-taxonomy";
import type { SectionType } from "@/lib/sections/types";

export interface VisualEngine2BCase {
  id: string;
  brief: string;
  intent: IntentAnalysis;
  expectedRoles?: CanonicalSectionRole[];
  expectedComponents?: SectionType[];
  expectedFallback?: "unsupported_section_role";
  requiredVisualSignals: string[];
  forbiddenVisualSignals: string[];
}

function intent(
  siteType: string,
  roles: string[],
  domains: string[],
  audience: string,
  required: string[],
  forbidden: string[],
): IntentAnalysis {
  return IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0",
    language: "es",
    functional: { siteType, requiredSections: roles, primaryActions: ["explore"], contentModel: "structured_content" },
    audience: { primary: audience, ageRange: "general", secondary: [] },
    domains,
    emotionalGoals: ["clear", "distinctive"],
    requiredVisualSignals: required,
    forbiddenVisualSignals: forbidden,
    explicitConstraints: [], ambiguities: [], confidence: 0.95,
  });
}

function supported(
  id: string,
  brief: string,
  roles: CanonicalSectionRole[],
  components: SectionType[],
  domain: string,
  audience: string,
  required: string[],
  forbidden: string[],
): VisualEngine2BCase {
  const orderedRoles = ["header", ...roles, "footer"] as CanonicalSectionRole[];
  const orderedComponents = ["navbar", ...components, "footer"] as SectionType[];
  return { id, brief, intent: intent("content_platform", roles, [domain], audience, required, forbidden), expectedRoles: orderedRoles, expectedComponents: orderedComponents, requiredVisualSignals: required, forbiddenVisualSignals: forbidden };
}

export const VISUAL_ENGINE_2B_CASES: readonly VisualEngine2BCase[] = Object.freeze([
  supported("kids-coloring", "Plataforma infantil para colorear con minijuegos, cuentos y actividades.", ["hero", "coloring_gallery", "minigames", "stories", "activities"], ["hero", "gallery", "features", "features", "features"], "creative_play", "children", ["coloring_art", "playful"], ["corporate_dashboard"]),
  supported("kids-stories", "Club mágico de cuentos ilustrados para niñas, niños y familias.", ["hero", "stories", "activities"], ["hero", "features", "features"], "childrens_stories", "children", ["storybook", "magical"], ["enterprise_saas"]),
  supported("kids-printables", "Biblioteca de imprimibles creativos y páginas de arte para familias.", ["hero", "coloring_gallery", "activities"], ["hero", "gallery", "features"], "printable_activities", "parents", ["hand_drawn", "friendly"], ["corporate_dashboard"]),
  supported("restaurant-menu", "Restaurante cálido con menú, reservaciones y ubicación.", ["hero", "menu", "reservations", "location"], ["hero", "features", "contact", "contact"], "food_beverage", "consumers", ["warm_hospitality"], ["technical_dashboard"]),
  supported("boutique-hotel", "Hotel boutique sereno con galería, reservación y contacto.", ["hero", "gallery", "booking", "contact"], ["hero", "gallery", "contact", "contact"], "hospitality", "guests", ["editorial_photography"], ["playful_kids"]),
  supported("wellness-studio", "Estudio de bienestar con servicios, horarios y reserva.", ["hero", "services", "schedule", "booking"], ["hero", "features", "features", "contact"], "wellness", "adults", ["calm", "organic"], ["dense_enterprise"]),
  supported("local-workshop", "Taller local cercano con servicios, ubicación y contacto.", ["hero", "services", "location", "contact"], ["hero", "features", "contact", "contact"], "local_business", "homeowners", ["trustworthy", "local"], ["startup_saas"]),
  supported("saas-observability", "Producto SaaS técnico con capacidades, precios y preguntas frecuentes.", ["hero", "features", "pricing", "faq"], ["hero", "features", "pricing", "faq"], "developer_tools", "developers", ["technical", "precise"], ["childrens_play"]),
  supported("developer-platform", "Plataforma para desarrolladores con flujo e integraciones.", ["hero", "how_it_works", "integrations"], ["hero", "how-it-works", "integrations"], "developer_platform", "developers", ["technical", "modular"], ["luxury_editorial"]),
  supported("artist-portfolio", "Portafolio editorial de artista con obra, historia y contacto.", ["hero", "gallery", "about", "contact"], ["hero", "gallery", "about", "contact"], "art_portfolio", "creative_clients", ["editorial", "art_focused"], ["dashboard_ui"]),
  supported("independent-magazine", "Revista independiente con contenido destacado, noticias y newsletter.", ["hero", "featured_content", "news", "newsletter"], ["hero", "features", "features", "features"], "editorial", "readers", ["editorial_grid"], ["sales_dashboard"]),
  supported("community-events", "Comunidad creativa con eventos, historias y redes sociales.", ["hero", "events", "stories", "social_links"], ["hero", "features", "features", "contact"], "community", "creatives", ["community_energy"], ["corporate_dashboard"]),
  supported("content-library", "Biblioteca de contenido con artículos, listas y recursos destacados.", ["hero", "blog", "content_list", "featured_content"], ["hero", "features", "features", "features"], "content_library", "readers", ["content_rich"], ["empty_marketing"]),
  { id: "unsupported-map", brief: "Experiencia que exige un mapa interactivo como sección principal.", intent: intent("local_experience", ["interactive_map"], ["travel"], "consumers", ["map_first"], ["static_list"]), expectedFallback: "unsupported_section_role", requiredVisualSignals: ["map_first"], forbiddenVisualSignals: ["static_list"] },
  { id: "unsupported-scene", brief: "Exposición que exige una escena tridimensional inmersiva.", intent: intent("immersive_exhibit", ["immersive_3d_scene"], ["art"], "fans", ["immersive_3d"], ["flat_catalog"]), expectedFallback: "unsupported_section_role", requiredVisualSignals: ["immersive_3d"], forbiddenVisualSignals: ["flat_catalog"] },
]);
