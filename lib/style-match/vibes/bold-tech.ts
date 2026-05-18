import type { VibeBrief } from "./types";

export const boldTech: VibeBrief = {
  id: "bold-tech",
  name: "Bold Tech",
  nameEs: "Tech Atrevido",
  tagline: "High-contrast extremes. Oversized type. No filler.",
  taglineEs: "Contraste extremo. Tipografía gigante. Sin relleno.",
  inspiration: "Vercel, Neon, Resend marketing pages, Plain",
  preview: { bg: "#000000", fg: "#ffffff", accent: "#ffffff" },
  brief: `VIBE: Bold Tech — High-contrast minimal extremes

CORE PHILOSOPHY
Pure visual confidence. Almost-only black and white. Massive bold display typography. Sharp corners. The page feels like a poster more than a website. The product is so good it doesn't need decoration — just monumental confidence. Designed for technical audiences who appreciate restraint pushed to the limit.

COLORS (use exactly these)
- Background: #000000 (pure black) OR #ffffff (pure white) — pick ONE based on source HTML's existing polarity, but if both work, prefer black for hero / white for content sections, alternating
- Foreground: the inverse of background. Black bg → white text. White bg → black text. ALWAYS maximum contrast.
- Accent: same as foreground OR a single optional grayscale step (#737373) for muted text
- NO colored accents in this vibe. The contrast IS the accent.
- Border: matches text color at 10% alpha (rgba(255,255,255,0.1) on black, rgba(0,0,0,0.1) on white)
- Optional bright color injection (use SPARINGLY, only on one element max): a single saturated color like #ff6b35 or #00ff88, but only as an underline on one key word or a dot

TYPOGRAPHY
- Family: a confident neo-grotesque sans. Declare as: 'Geist', 'Inter', 'Helvetica Neue', system-ui, sans-serif. Geist via @vercel/font if available; else Inter.
- Mono for code: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace
- Scale: dramatic ratio 1.5 (perfect fifth) → sizes 14, 16, 18, 24, 36, 56, 84, 128
- Weights: 400 body, 500 medium, 600 emphasis, 800 display headings (very bold)
- Letter-spacing: -0.035em on display headings (very tight, almost touching), -0.02em on h3-h4, normal on body
- Line-height: 0.95 on display headings (touching lines is the look), 1.15 on h3-h4, 1.5 on body

SPACING
- Base unit: 4px
- Section padding-y: dramatic — py-32 mobile, md:py-48 lg:py-64
- Container max-width: full-bleed everywhere (no max-w on hero); internal max-w-6xl for body content sections
- Hero takes 90-100vh on desktop, the headline is the only thing visible

SHADOWS
- ZERO shadows. Flat black and flat white.
- If separation is needed, use a 1px line (border-t in 10%-alpha color)

BORDER RADIUS
- ALL elements: 0px (sharp) or 4px MAX (subtle softening only on inputs)
- NEVER 8px+ radius
- NEVER pill

SIGNATURE ELEMENTS
- Hero treatment: oversized display heading taking up most of the viewport. text-5xl mobile, md:text-8xl, lg:text-9xl (or text-[140px] if pushing). 800 weight. -0.035em tracking. Heading lines OVERLAP slightly (line-height 0.95). Left-aligned. Below it: one-line subhead in much smaller text, plus a single sharp button.
- CTAs: rectangular sharp corners, monochromatic (white bg + black text on dark sections, or black bg + white text on light sections). Generous padding (px-8 py-4). 500-600 weight. Hover: invert colors (bg becomes text, text becomes bg). No shadow.
- Feature sections: alternating full-bleed black and white panels (section.bg-black then section.bg-white). Aggressive but cohesive.
- Pricing: oversized numbers, e.g., the price displayed in 84px+ font with the currency symbol smaller and lifted as superscript
- Code blocks: monospace, optionally inverted (white-on-black inside a white section, or black-on-white inside a black section)
- Optional: a SINGLE saturated color as accent in ONE element max (e.g., one key word underlined in #00ff88) — but this is rare and optional

DO
- Push display headings to extreme sizes (84px+ on desktop)
- Use line-height 0.95-1.0 on display so headings touch
- Tight tracking on all big type (-0.03em+)
- Alternating black/white sections (no in-between grays)
- Sharp rectangular corners on everything
- Geist or Inter at weight 800 for display
- 100vh hero with single headline + single CTA

DON'T
- Grayscale gradients (just flat black + flat white, no in-between)
- Drop shadows of any kind
- Colored CTAs (white CTA on dark, black CTA on light — maximum contrast only)
- Soft rounded corners (8px+ radius is banned)
- Pill anything
- Decorative illustrations or stock photo backgrounds
- Subtle pastel sections (this vibe is high-contrast, period)
- Multiple bright colors at once (one optional saturated accent on ONE element)

TRANSFORMATION INSTRUCTIONS
When applying this vibe to a user's existing HTML:
1. Pick dominant polarity (dark or light); the hero should always be the bold-contrast one
2. Remove ALL Tailwind color utilities — replace with bg-black, bg-white, text-black, text-white only
3. Replace heading font sizes with the dramatic scale: h1 should go from typical text-5xl to text-8xl or larger on lg
4. Add weight 800 to all display headings (font-extrabold or font-black)
5. Tighten letter-spacing on all headings to -0.03em or more negative
6. Replace all rounded-* utilities with rounded-none (or rounded-sm max for inputs)
7. Remove all shadow-* utilities
8. Replace colored CTAs with monochrome (white-on-black or black-on-white)
9. Use 100vh on hero section if possible
10. Convert any centered hero to left-aligned (bold tech is left-aligned, brutal)
11. Alternate section backgrounds: if multiple sections exist, alternate bg-black and bg-white`,
};
