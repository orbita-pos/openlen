import type { VibeBrief } from "./types";

export const playfulProduct: VibeBrief = {
  id: "playful-product",
  name: "Playful Product",
  nameEs: "Producto Amigable",
  tagline: "Soft warm cream. Friendly approachable. Round and inviting.",
  taglineEs: "Crema suave cálida. Amigable y accesible. Redondo e invitador.",
  inspiration: "Notion, Linear (older), Calm, Headspace marketing",
  preview: { bg: "#fefcf6", fg: "#37352f", accent: "#e15c43" },
  brief: `VIBE: Playful Product — Warm friendly approachable

CORE PHILOSOPHY
The page feels like a friend explaining a product over coffee, not a corporate pitch. Soft warm cream background. Charcoal text that's confident but not aggressive. A signature warm accent (warm orange-red or coral). Generous radius makes everything feel inviting and tactile. Subtle soft shadows give an "almost touchable" depth. Small playful details (emoji icons used tastefully, hand-drawn-feeling underlines, slightly playful animations).

COLORS (use exactly these)
- Background: #fefcf6 (soft warm cream, slight ivory)
- Foreground / body text: #37352f (Notion's signature warm charcoal)
- Accent: #e15c43 (warm orange-red, friendly without being aggressive)
- Surface raised (cards): #ffffff with subtle warm shadow (alpha-warm-colored)
- Muted (secondary text): #787774
- Border (subtle): #e9e5d8
- Secondary fills (badges, highlights): #fde7d8 (peach tint) for accent backgrounds

TYPOGRAPHY
- Family: a friendly humanist sans. Declare as: 'Inter', 'Söhne', system-ui, sans-serif. Inter via Google Fonts (weights 400, 500, 600, 700)
- Optional display: same Inter at 600-700 weight, with slightly looser letter-spacing
- Scale ratio: 1.25 (major third) → sizes 14, 16, 18, 22, 28, 36, 48, 60
- Weights: 400 body, 500 emphasis (used liberally — Notion's signature is making "regular" feel like 500), 600 headings
- Letter-spacing: -0.005em on body (slight tightening), 0em on headings (relaxed), -0.01em on display
- Line-height: 1.5 on body (comfortable reading), 1.25 on headings (slightly loose for friendliness)

SPACING
- Base unit: 4px
- Section padding-y: balanced and inviting — py-16 mobile, md:py-20 lg:py-24
- Container max-width: max-w-5xl (1024px) — narrower than fintech, gives a "personal blog" feel
- Generous internal card padding: 24-40px
- Gap between elements feels comfortable, not packed: gap-6 minimum

SHADOWS — soft warm tone
- Cards: \`box-shadow: 0 2px 6px rgba(55, 53, 47, 0.04), 0 1px 2px rgba(55, 53, 47, 0.06)\`
- Floating CTAs (sparingly): \`box-shadow: 0 4px 12px rgba(225, 92, 67, 0.18), 0 1px 3px rgba(0, 0, 0, 0.06)\`
- Subtle on inputs (focus state only): \`box-shadow: 0 0 0 3px rgba(225, 92, 67, 0.15)\`
- All shadows are SOFT — low blur, low opacity, warm-tinted

BORDER RADIUS — generous, inviting
- Buttons: 10-12px
- Cards: 12-16px
- Inputs: 8-10px
- Pill (only for tags/badges): 9999px (ok here, friendly)
- Generally round everything more than you'd think

SIGNATURE ELEMENTS
- Hero treatment: centered or left-aligned (both work), 1-2 emoji-style icons next to the headline tastefully (e.g., "✨ Build something" — but ONLY 1 emoji max, don't overdo). Display heading text-4xl mobile, md:text-5xl lg:text-6xl. Weight 600-700.
- CTAs: rounded-xl (12px) or rounded-2xl (16px), solid accent #e15c43, white text, generous padding (px-6 py-3.5), the warm-tinted shadow listed above. On hover: slightly darken (filter: brightness(0.95)) + tiny lift (transform: translateY(-1px)).
- Secondary CTAs: white background, charcoal text, 1px border in #e9e5d8, same generous radius
- Feature cards: white bg, soft warm shadow, 16-20px radius, emoji icon at top (or a small inline SVG that feels playful), padding 32-40px
- Badges / tags: rounded-full, padding px-3 py-1, peachy background #fde7d8 with accent color text
- Section dividers: a thin wavy line OR a small decorative dot pattern (rare, restrained)
- Optional: a slight hand-drawn-feeling underline on a key headline word (use an SVG with a wobbly stroke, accent color)

DO
- Generous border radius on everything (12-16px is the default)
- Warm-toned colors throughout
- One emoji per key element (hero icon, feature icon), used tastefully
- Soft small shadows that feel warm
- Friendly tone in copy implied by the design
- Generous interior padding on cards (32-40px)
- Color-on-color badges (peach bg + accent text)
- Subtle hover micro-interactions (slight scale-up, slight darken, never gimmicky)

DON'T
- Sharp corners anywhere (everything is rounded 8px+ minimum)
- Cold colors (avoid pure-blue accents — this vibe is WARM)
- Heavy aggressive shadows (subtle only)
- Multiple bright competing colors (one accent + warm neutrals)
- Excessive emoji (one per section max — don't go full corporate emoji spam)
- Pure black text (use #37352f warm charcoal)
- Dark mode (this vibe is light cream paper)
- Pill rectangular CTAs (use 12-16px radius instead)

TRANSFORMATION INSTRUCTIONS
When applying this vibe to a user's existing HTML:
1. Background to cream #fefcf6, text to warm charcoal #37352f
2. Replace any blue/cool accents with warm orange-red #e15c43
3. Bump all border-radius up: rounded-md (6px) → rounded-xl (12px), rounded-lg (8px) → rounded-2xl (16px), inputs to rounded-lg+
4. Replace harsh shadows with the soft warm-tinted versions listed above
5. Add 1 thoughtful emoji icon to hero heading IF source HTML lacks one (don't add to existing sections that already have icons)
6. Bump card interior padding generously (p-6 → p-8 or p-10)
7. Convert pill-shape buttons that exist to rounded-xl rectangles (pills work for tags but not main CTAs)
8. If source has bg-blue-* tag/badge styles, replace with peach bg-[#fde7d8] + accent text
9. Add slight letter-spacing tightening on body (-0.005em) for that polished Notion feel
10. Keep all copy and structure intact`,
};
