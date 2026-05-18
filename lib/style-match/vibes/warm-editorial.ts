import type { VibeBrief } from "./types";

export const warmEditorial: VibeBrief = {
  id: "warm-editorial",
  name: "Warm Editorial",
  nameEs: "Editorial Cálido",
  tagline: "Paper-feel humanist. Cream backdrop. Calm gravitas.",
  taglineEs: "Tacto de papel humanist. Fondo crema. Gravedad calmada.",
  inspiration: "Anthropic, The New York Times opinion section, Pitchfork",
  preview: { bg: "#faf9f5", fg: "#141413", accent: "#cc785c" },
  brief: `VIBE: Warm Editorial — Paper humanist

CORE PHILOSOPHY
The site feels like a printed essay or a thoughtful long-form publication — calm, considered, warm. Cream paper-tone backdrop. Charcoal text that reads like serious editorial. The product is presented as a research finding or a craft, not a shouted pitch. Reads more than scans.

COLORS (use exactly these)
- Background: #faf9f5 (warm cream, slight beige undertone)
- Foreground / body text: #141413 (warm charcoal, not pure black)
- Accent: #cc785c (terracotta / burnt orange — used SPARINGLY for: link color, key word emphasis, small icon details, pull-quote underline, focused state. NOT for buttons.)
- Surface raised: #f3f1e9 (slightly darker cream for blockquotes / code blocks)
- Muted (secondary text, captions, metadata): #5d5d5a
- Border (rules between sections, image captions): #e3dacc

TYPOGRAPHY
- Body family: a humanist sans (declare as: 'Source Sans 3', 'Inter', system-ui, sans-serif). Add Google Fonts link for Source Sans 3 weights 400/500/600.
- Display family for headings: a serif for editorial gravitas. Declare as: 'Source Serif 4', 'Charter', 'Georgia', serif. Add Google Fonts link for Source Serif 4 weights 400/600/700.
- Scale ratio: major third 1.25 → sizes 14, 16, 18, 22, 28, 36, 48, 60
- Weights: 400 body, 600 emphasis, 700 display headings only
- Letter-spacing: 0em on body, -0.01em on display headings (serif looks great near-zero)
- Line-height: 1.6 on body paragraphs (generous for reading), 1.2 on display headings, 1.4 on h3-h4

SPACING
- Base unit: 4px
- Section padding-y: balanced — py-20 mobile, md:py-28 lg:py-32 (less extreme than Technical Dark)
- Container max-width: max-w-3xl (768px) for most content (editorial column width); max-w-5xl for hero / wide sections
- Vertical rhythm in long-form content: large space between paragraphs (mb-6 minimum), pull-quotes get py-8 my-12 with no border, just indent

SHADOWS
- ZERO shadows on this vibe. Flat editorial.
- Use 1px borders in #e3dacc for cards / dividers / pull-quotes if separation is needed.

BORDER RADIUS
- Buttons: 4-6px (subtle, restrained)
- Cards: 6px
- Pull-quotes: 0 (sharp editorial blocks)
- Inputs: 4px
- NEVER pill anything

SIGNATURE ELEMENTS
- Hero treatment: display heading in serif, weight 700, large (text-4xl mobile, md:text-6xl), left-aligned (NOT centered — editorial is left-aligned), short subhead in sans-serif at 1.1× body size.
- Body paragraphs feel like reading an essay: max-w-prose (max-w-3xl), text-base/text-lg, line-height 1.6, mb-6 between paragraphs.
- Pull-quotes: italic, serif, large (text-2xl), indented (pl-6), no quote marks, with a thin border-left in accent terracotta.
- CTAs: NOT solid colored buttons. Use a charcoal underline link OR a charcoal button with cream text + 1px border. Terracotta accent is used in text emphasis, NOT in buttons.
- Image captions: serif italic, smaller (text-sm), muted color, with thin border-top in #e3dacc.
- Article-style numbered lists, lettered footnotes (text-sm subscript) if the source HTML supports it.

DO
- Generous reading column width (max-w-prose)
- Long line-heights for readability (1.6+ on body)
- Serif headings, sans body
- Editorial left-alignment (no centered headings)
- Small caps on labels / categories (text-xs uppercase tracking-wider)
- Thin 1px dividers in warm beige instead of bold borders
- Terracotta accent in text emphasis (links, key words), not buttons

DON'T
- Drop shadows of any kind (flat editorial)
- Centered hero headings (editorial is left-aligned)
- Bold pure-black on pure-white contrast (warm charcoal on cream is the rule)
- Loud saturated CTAs (use charcoal underlined links or restrained borders)
- Dark mode (this vibe is daylight paper, period)
- Multiple display fonts (one serif for display + one sans for body)
- Pill buttons (sharp or near-sharp corners only)
- Stock photography hero images (editorial uses curated photography or none)

TRANSFORMATION INSTRUCTIONS
When applying this vibe to a user's existing HTML:
1. Convert background to cream #faf9f5, text to #141413
2. Replace all heading fonts with the serif stack
3. Replace body fonts with the humanist sans stack
4. Remove ALL box-shadow utilities — flat editorial
5. Narrow content containers to max-w-3xl for body sections (max-w-5xl ok for hero)
6. Convert centered hero headings to left-aligned
7. Change solid colored CTAs to charcoal buttons with cream text + thin border, OR underlined link style
8. Where you find blue/indigo links, replace with terracotta #cc785c
9. Increase line-height on body to 1.6+
10. Replace any pill buttons with rounded-md (4-6px) or sharp (0px) rectangles
11. Keep all copy structure intact`,
};
