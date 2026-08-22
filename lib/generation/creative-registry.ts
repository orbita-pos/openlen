export const CREATIVE_TOKEN_ALLOWLIST = new Set([
  "--ol-bg", "--ol-surface", "--ol-surface-2", "--ol-fg",
  "--ol-fg-muted", "--ol-fg-faint", "--ol-border",
  "--ol-border-strong", "--ol-accent", "--ol-accent-ink",
  "--ol-radius", "--ol-r-scale", "--ol-space-scale",
  "--ol-text-scale", "--ol-font-display", "--ol-font-body",
  "--ol-font-mono",
]);

export const CREATIVE_FONT_MOODS = {
  rounded_playful: { display: "'Plus Jakarta Sans', sans-serif", body: "'Plus Jakarta Sans', sans-serif" },
  friendly_high_legibility: { display: "'Manrope', sans-serif", body: "'Inter', sans-serif" },
  modern_geometric: { display: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif" },
  editorial_warm: { display: "'Fraunces', serif", body: "'Inter', sans-serif" },
  literary: { display: "'Crimson Pro', serif", body: "'Crimson Pro', serif" },
  elegant_editorial: { display: "'Playfair Display', serif", body: "'Inter', sans-serif" },
  technical: { display: "'Geist', sans-serif", body: "'Inter', sans-serif" },
} as const;

export const HOOK_PROPERTY_POLICY = {
  page: ["background-color", "color", "font-family"],
  navigation: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow"],
  hero: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow", "text-align"],
  section: ["background-color", "color", "border-color", "border-radius", "padding", "gap"],
  cards: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow"],
  buttons: ["background-color", "color", "border-color", "border-radius", "padding", "box-shadow"],
  icons: ["color", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "border-radius"],
} as const;

export const CREATIVE_RADIUS_SCALES = [0, 1, 1.75] as const;
export const CREATIVE_SPACING_SCALES = [0.85, 1, 1.15] as const;

/** `geometry.radius` / `typography.scale` in CSS. Here, not inline in a
 *  consumer, because two places now turn a CreativeDirection into page tokens —
 *  the creative compiler and the baseline's assemble theme — and a direction
 *  that means one radius in one and another in the other is the drift that let
 *  a dark page ship with a light theme in the first place. */
export const CREATIVE_RADIUS_PX = {
  square: "0px",
  soft: "8px",
  round: "14px",
  extra_round: "20px",
} as const;

export const CREATIVE_TEXT_SCALES = {
  compact: "0.94",
  balanced: "1",
  expressive: "1.08",
} as const;
