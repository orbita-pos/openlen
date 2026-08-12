import type { CreativeDirection } from "./creative-contracts";
import type { IntentAnalysis } from "./contracts";
import type { DerivedSectionSemantics } from "./derived-section-contracts";

export const SECTION_SEMANTIC_TAGS = [
  "neutral",
  "playful",
  "creator",
  "illustrated",
  "editorial",
  "cinematic",
  "event",
  "marquee",
  "school",
  "community",
  "warm",
  "photographic",
  "tactile",
  "wellness",
  "commerce",
  "commerce_grid",
  "product",
  "dashboard",
  "analytics",
  "software_mockup",
  "course_ui",
  "corporate",
  "developer_tool",
  "documentation",
  "game_ui",
  "terminal",
] as const;

export type SectionSemanticTag = typeof SECTION_SEMANTIC_TAGS[number];

export interface SectionVariantSemanticProfile {
  readonly tags: readonly SectionSemanticTag[];
  readonly source: "derived_metadata" | "reviewed_override" | "catalog_tokens" | "neutral";
}

export interface SectionSemanticPolicy {
  readonly preferred: readonly SectionSemanticTag[];
  readonly forbidden: readonly SectionSemanticTag[];
}

const REVIEWED_OVERRIDES = Object.freeze({
  "hero-01": ["analytics", "dashboard", "software_mockup"],
  "hero-03": ["analytics", "dashboard"],
  "features-01": ["analytics", "dashboard", "developer_tool"],
  "features-03": ["analytics", "dashboard", "software_mockup"],
} satisfies Record<string, readonly SectionSemanticTag[]>);

const TOKEN_TAGS = Object.freeze({
  analytics: ["analytics"],
  cinematic: ["cinematic"],
  code: ["developer_tool"],
  commerce: ["commerce"],
  community: ["community"],
  corporate: ["corporate"],
  course: ["course_ui"],
  creative: ["creator"],
  creator: ["creator"],
  dashboard: ["dashboard"],
  developer: ["developer_tool"],
  devtool: ["developer_tool"],
  docs: ["documentation"],
  documentation: ["documentation"],
  ecommerce: ["commerce"],
  editorial: ["editorial"],
  event: ["event"],
  events: ["event"],
  game: ["game_ui"],
  illustrated: ["illustrated"],
  ilustrated: ["illustrated"],
  marketplace: ["commerce"],
  marquee: ["marquee"],
  metrics: ["analytics"],
  photo: ["photographic"],
  photographic: ["photographic"],
  photography: ["photographic"],
  playful: ["playful"],
  playground: ["playful"],
  product: ["product"],
  school: ["school"],
  tactile: ["tactile"],
  terminal: ["terminal"],
  warm: ["warm"],
  wellness: ["wellness"],
} satisfies Record<string, readonly SectionSemanticTag[]>);

const FORBIDDEN_SIGNAL_TAGS = Object.freeze({
  saas_dashboard: ["analytics", "corporate", "dashboard", "software_mockup"],
  saas_dark_mode: ["dashboard", "software_mockup"],
  course_progress_ui: ["analytics", "course_ui", "dashboard"],
  adult_course_saas: ["analytics", "course_ui", "dashboard"],
  abstract_software_mockup: ["dashboard", "software_mockup"],
  developer_tool_ui: ["developer_tool", "documentation", "terminal"],
  documentation_layout: ["developer_tool", "documentation", "terminal"],
  generic_game_ui: ["game_ui"],
  generic_ecommerce_grid: ["commerce_grid"],
  wellness_dashboard: ["analytics", "dashboard", "wellness"],
  corporate_photography: ["corporate"],
  corporate_event_branding: ["corporate"],
  conference_agenda: ["corporate"],
} satisfies Record<string, readonly SectionSemanticTag[]>);

const PREFERRED_SIGNAL_TAGS = Object.freeze({
  creative_play: ["creator", "illustrated", "playful", "warm"],
  illustrated_activity_book: ["creator", "illustrated", "playful", "warm"],
  hand_drawn_illustrations: ["creator", "illustrated", "playful"],
  playful_color_blocks: ["creator", "playful"],
  rounded_shapes: ["playful", "warm"],
  horror_entertainment: ["cinematic", "editorial"],
  cinematic_horror_poster: ["cinematic", "editorial"],
  cinematic_darkness: ["cinematic"],
  atmospheric_texture: ["cinematic", "tactile"],
  dramatic_typography: ["cinematic", "editorial"],
  live_comedy: ["event", "marquee", "photographic", "playful"],
  live_comedy_marquee: ["event", "marquee", "photographic", "playful"],
  performer_portraits: ["event", "photographic"],
  stage_energy: ["event", "marquee", "playful"],
  video_games: ["cinematic", "game_ui", "illustrated"],
  immersive_game_launch: ["cinematic", "game_ui", "illustrated"],
  gameplay_screens: ["cinematic", "game_ui"],
  world_building: ["cinematic", "illustrated"],
  school_education: ["community", "editorial", "photographic", "school", "warm"],
  welcoming_school_community: ["community", "editorial", "photographic", "school", "warm"],
  real_learning_spaces: ["community", "photographic", "school", "warm"],
  family_trust: ["community", "school", "warm"],
  food_editorial: ["editorial", "photographic", "tactile", "warm"],
  sensory_culinary_journal: ["editorial", "photographic", "tactile", "warm"],
  ingredient_photography: ["editorial", "photographic", "tactile"],
  culinary_texture: ["editorial", "tactile", "warm"],
  home_goods: ["commerce", "photographic", "product", "tactile"],
  tactile_product_showcase: ["commerce", "photographic", "product", "tactile"],
  product_closeups: ["photographic", "product", "tactile"],
  material_detail: ["photographic", "product", "tactile"],
} satisfies Record<string, readonly SectionSemanticTag[]>);

function normalizedValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asciiTokens(values: readonly string[]): string[] {
  return values.flatMap((value) => normalizedValue(value).split("_").filter(Boolean));
}

function sortedTags(values: Iterable<SectionSemanticTag>): SectionSemanticTag[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function tagsFromCatalogText(values: readonly string[]): SectionSemanticTag[] {
  const tokens = asciiTokens(values);
  const tokenSet = new Set(tokens);
  const tags: SectionSemanticTag[] = [];
  for (const token of tokens) {
    tags.push(...(TOKEN_TAGS[token as keyof typeof TOKEN_TAGS] ?? []));
  }
  if ((tokenSet.has("commerce") || tokenSet.has("ecommerce") || tokenSet.has("marketplace")) && tokenSet.has("grid")) {
    tags.push("commerce_grid");
  }
  if (tokenSet.has("software") && tokenSet.has("mockup")) tags.push("software_mockup");
  if (tokenSet.has("course") && (tokenSet.has("ui") || tokenSet.has("progress"))) tags.push("course_ui");
  if ((tokenSet.has("game") || tokenSet.has("gaming")) && tokenSet.has("ui")) tags.push("game_ui");
  return sortedTags(tags);
}

export function profileSectionVariant(input: {
  readonly id: string;
  readonly name: string;
  readonly variantLabel: string;
}): SectionVariantSemanticProfile {
  const override = REVIEWED_OVERRIDES[input.id as keyof typeof REVIEWED_OVERRIDES];
  if (override) {
    return Object.freeze({
      tags: Object.freeze(sortedTags(override)),
      source: "reviewed_override" as const,
    });
  }
  const tags = tagsFromCatalogText([input.name, input.variantLabel]);
  return tags.length > 0
    ? Object.freeze({ tags: Object.freeze(tags), source: "catalog_tokens" as const })
    : Object.freeze({ tags: Object.freeze(["neutral"] as const), source: "neutral" as const });
}

const DERIVED_DOMAIN_TAGS = Object.freeze({
  children_creativity: ["creator", "illustrated", "playful", "warm"],
  cooking: ["editorial", "photographic", "tactile", "warm"],
  education: ["community", "editorial", "school", "warm"],
  entertainment_horror: ["cinematic", "editorial"],
  hospitality: ["editorial", "photographic", "warm"],
  physical_product: ["commerce", "photographic", "product", "tactile"],
  professional_services: ["editorial"],
  saas: ["analytics", "dashboard", "software_mockup"],
} satisfies Record<DerivedSectionSemantics["domains"][number], readonly SectionSemanticTag[]>);

export function profileDerivedSectionSemantics(
  semantics: DerivedSectionSemantics,
): SectionVariantSemanticProfile {
  const tags: SectionSemanticTag[] = [...semantics.negativeSignals];
  for (const domain of semantics.domains) tags.push(...DERIVED_DOMAIN_TAGS[domain]);
  for (const mood of semantics.moods) {
    if (mood === "playful") tags.push("playful");
    if (mood === "warm") tags.push("warm");
    if (mood === "cinematic" || mood === "atmospheric") tags.push("cinematic");
    if (mood === "editorial") tags.push("editorial");
    if (mood === "tactile") tags.push("tactile");
  }
  for (const layout of semantics.layoutArchetypes) {
    if (layout === "editorial") tags.push("editorial");
    if (layout === "gallery") tags.push("photographic");
    if (layout === "marquee") tags.push("marquee");
  }
  return Object.freeze({
    tags: Object.freeze(sortedTags(tags.length > 0 ? tags : ["neutral"])),
    source: "derived_metadata" as const,
  });
}

function mappedTags<T extends Record<string, readonly SectionSemanticTag[]>>(
  values: readonly string[],
  mapping: T,
): SectionSemanticTag[] {
  return values.flatMap((value) => mapping[normalizedValue(value) as keyof T] ?? []);
}

export function buildSectionSemanticPolicy(
  intent: IntentAnalysis,
  direction: CreativeDirection,
): SectionSemanticPolicy {
  const positiveSignals = [
    intent.functional.siteType,
    intent.functional.contentModel,
    ...intent.domains,
    ...intent.emotionalGoals,
    ...intent.requiredVisualSignals,
    direction.visualArchetype,
    ...direction.emotionalTone,
    direction.imagery.strategy,
    direction.imagery.artDirection,
    ...direction.imagery.subjects,
    ...direction.requiredVisualSignals,
  ];
  const forbiddenSignals = [
    ...intent.forbiddenVisualSignals,
    ...direction.forbiddenVisualSignals,
    ...direction.imagery.avoid,
  ];
  const preferred = sortedTags([
    ...mappedTags(positiveSignals, PREFERRED_SIGNAL_TAGS),
    ...tagsFromCatalogText(positiveSignals),
  ]);
  const forbidden = sortedTags([
    ...mappedTags(forbiddenSignals, FORBIDDEN_SIGNAL_TAGS),
  ]);
  return Object.freeze({
    preferred: Object.freeze(preferred),
    forbidden: Object.freeze(forbidden),
  });
}

export function scoreSectionSemanticProfile(
  profile: SectionVariantSemanticProfile,
  policy: SectionSemanticPolicy,
): { eligible: boolean; score: number; forbiddenMatches: SectionSemanticTag[] } {
  const tags = new Set(profile.tags);
  const forbiddenMatches = policy.forbidden.filter((tag) => tags.has(tag));
  if (forbiddenMatches.length > 0) {
    return { eligible: false, score: 0, forbiddenMatches: [...forbiddenMatches] };
  }
  const score = policy.preferred.reduce(
    (total, tag) => total + (tags.has(tag) ? 25 : 0),
    0,
  );
  return { eligible: true, score, forbiddenMatches: [] };
}
