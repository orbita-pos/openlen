import type { ExtractedTokens } from "../extract/types";

export const SYSTEM_PROMPT = `You are a senior brand designer analyzing landing pages for an HTML page-builder named OpenLen. You return strict JSON only — no prose, no preamble, no markdown fences, nothing outside the JSON object.

Your job is qualitative pattern recognition: visual hierarchy, motion implied by layout, design language taxonomy, and color role assignment. The exact hex values, font names, and spacing scale have already been extracted programmatically from the page CSS — your role is to interpret what those tokens MEAN together and which one plays which role.

Be decisive. If the page is a dark technical product page, say "technical" not "modern". If a heavy gradient covers half the canvas, the design language is not "minimal". Pick the single best label.

Color role assignment is the most important field — programmatic extraction can identify candidate hex values but not always WHICH is the brand's primary vs a campaign accent vs a neutral. Use the screenshot to disambiguate.`;

function summarizePalette(tokens: ExtractedTokens): string {
  const lines: string[] = [];
  if (tokens.color.primary) {
    lines.push(
      `  • ${tokens.color.primary.hex}  (primary candidate, chroma=${tokens.color.primary.oklch.c.toFixed(3)}, ${tokens.color.primary.occurrenceCount} uses)`,
    );
  }
  for (const a of tokens.color.accents) {
    lines.push(
      `  • ${a.hex}  (accent candidate, chroma=${a.oklch.c.toFixed(3)}, ${a.occurrenceCount} uses)`,
    );
  }
  for (const n of tokens.color.neutrals) {
    lines.push(`  • ${n.entry.hex}  (neutral ${n.step}, L=${n.entry.oklch.l.toFixed(2)})`);
  }
  return lines.join("\n");
}

export interface UserMessageParts {
  text: string;
  imageBase64: string;
  imageMime: "image/jpeg" | "image/png";
}

export function buildUserMessage(
  tokens: ExtractedTokens,
  screenshot: Buffer,
  imageMime: "image/jpeg" | "image/png" = "image/jpeg",
): UserMessageParts {
  const palette = summarizePalette(tokens);
  const fonts = [
    tokens.typography.family.primary,
    tokens.typography.family.display ? `display: ${tokens.typography.family.display}` : null,
    tokens.typography.family.mono ? `mono: ${tokens.typography.family.mono}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const sizes = tokens.typography.size.detected.join(", ");
  const ratio = tokens.typography.size.ratio
    ? `${tokens.typography.size.ratio.toFixed(3)} (${tokens.typography.size.ratioMatch})`
    : "no clean ratio detected";

  const text = `Source: ${tokens.source.hostname}
Polarity (background lightness): ${tokens.color.polarity}

PALETTE (programmatically extracted, ranked by weighted usage):
${palette}

FONTS: ${fonts}
TYPE SIZES: ${sizes}px
TYPE SCALE: ${ratio}
SPACING BASE: ${tokens.spacing.base}px
RADIUS PERSONALITY (heuristic): ${tokens.radius.personality}  (distinct: ${tokens.radius.distinctValues.slice(0, 8).join(", ")})
SHADOW PERSONALITY (heuristic): ${tokens.shadow.personality}  (${tokens.shadow.distinct.length} distinct)

Now look at the screenshot and return JSON with EXACTLY this shape:

{
  "design_language": "modern" | "warm" | "brutal" | "editorial" | "technical" | "playful",
  "design_language_confidence": 0.0 to 1.0,
  "visual_hierarchy_clarity": 1 to 5,
  "whitespace_use": "tight" | "balanced" | "generous",
  "motion_implied": "still" | "subtle" | "dynamic",
  "color_roles": {
    "background": "#hex",
    "foreground_primary": "#hex",
    "accent": "#hex",
    "muted": "#hex",
    "border": "#hex"
  },
  "top_3_design_choices_that_define_this_page": ["string ≤120 chars", "string", "string"],
  "type_personality": "geometric" | "humanist" | "neogrotesque" | "serif_editorial" | "display_decorative",
  "shadow_intensity": "none" | "subtle" | "dramatic",
  "radius_personality": "sharp" | "soft" | "pill",
  "vibe_summary": "string ≤180 chars — the line we'd write to describe this page's vibe"
}

Rules:
1. Every "#hex" value MUST come from the PALETTE above. Do not invent hex values.
2. "color_roles.foreground_primary" is the dominant text color. "accent" is the brand color that defines a CTA (NOT a campaign decoration).
3. If the page has multiple campaign-themed sections (lime panel, pink panel, etc.), the "accent" is still the brand's primary identity color, not the loudest panel. Look at navigation, logo, primary CTA.
4. Return JSON only. No preamble. No markdown.

Two short examples to anchor the shape:

EXAMPLE A — linear.app (dark technical):
{"design_language":"technical","design_language_confidence":0.92,"visual_hierarchy_clarity":5,"whitespace_use":"generous","motion_implied":"subtle","color_roles":{"background":"#08090A","foreground_primary":"#F7F8F8","accent":"#5E6AD2","muted":"#62666D","border":"#1F2023"},"top_3_design_choices_that_define_this_page":["High-contrast dark canvas with single indigo accent","Tight Inter type at 14-16px with restrained scale","Gradient seam separators replacing hard borders"],"type_personality":"neogrotesque","shadow_intensity":"subtle","radius_personality":"soft","vibe_summary":"Engineering-craft minimalism: dark, dense, one accent, zero ornament."}

EXAMPLE B — anthropic.com (warm humanist):
{"design_language":"warm","design_language_confidence":0.88,"visual_hierarchy_clarity":4,"whitespace_use":"generous","motion_implied":"still","color_roles":{"background":"#FAF9F5","foreground_primary":"#141413","accent":"#CC785C","muted":"#5D5D5A","border":"#E3DACC"},"top_3_design_choices_that_define_this_page":["Cream paper backdrop with charcoal text feels like a printed essay","Anthropic Sans gives editorial gravitas without serif formality","Zero shadows — flat, calm, intentional restraint"],"type_personality":"humanist","shadow_intensity":"none","radius_personality":"soft","vibe_summary":"A warm, paper-feeling essay site that signals research over hype."}`;

  return {
    text,
    imageBase64: screenshot.toString("base64"),
    imageMime,
  };
}
