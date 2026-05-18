import type { VibeBrief } from "./types";

export const technicalDark: VibeBrief = {
  id: "technical-dark",
  name: "Technical Dark",
  nameEs: "Técnico Oscuro",
  tagline: "Engineering minimalism. Dark canvas. One accent. Zero ornament.",
  taglineEs: "Minimalismo de ingeniería. Canvas oscuro. Un solo acento. Cero ornamento.",
  inspiration: "Linear, Vercel app docs, Resend",
  preview: { bg: "#0a0a0a", fg: "#f7f8f8", accent: "#5E6AD2" },
  brief: `VIBE: Technical Dark — Engineering minimalism

CORE PHILOSOPHY
A dense, monochromatic dark canvas with one signature accent. The page feels like an engineering tool more than a marketing site — built for developers and product folks who appreciate restraint and density over decoration. Every visual choice signals "we sweat the details on the actual product, not the marketing site."

COLORS (use exactly these, do not invent variations)
- Background: #0a0a0a (warm near-black, slightly bluer than pure black)
- Foreground / body text: #f7f8f8 (off-white, slight cool tint)
- Accent: #5E6AD2 (indigo) — used SPARINGLY for: primary CTA fill, active nav state, link underline-on-hover, the dot/highlight on key word in hero, focused input outline. NEVER as a section background or large fill.
- Surface raised (cards on dark canvas): #161718
- Muted (secondary text, less emphasis): #8a8f98
- Border (dividers, card edges): #1f2023

TYPOGRAPHY
- Family: Inter (load via Google Fonts variable). Add the link to <head>: https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap
- Scale ratio: minor third 1.2 → sizes 14, 16, 18, 24, 32, 48, 72
- Weights: 400 body, 500 medium-emphasis, 600 headings; never 700+ for body
- Letter-spacing: -0.02em on h1/h2/h3, -0.015em on smaller headings, -0.005em on body
- Line-height: 1.1 on display headings (h1, h2), 1.3 on h3-h4, 1.5 on body and paragraphs

SPACING — important: do NOT over-pad. Linear is generous but not airy.
- Base unit: 4px (Tailwind default)
- HERO section ONLY: py-20 mobile, md:py-28 lg:py-32 (the hero gets the most breathing room)
- ALL OTHER sections (features, pricing, FAQ, etc.): py-14 mobile, md:py-16 lg:py-20 — these are TIGHTER than the hero so the page doesn't feel sparse
- Between-section gap: rely on section padding only — DO NOT add extra margin-top to sections
- Container max-width: max-w-6xl (1152px) for content; full-bleed (no max-w) for hero with internal max-w-6xl on the inner content
- Gap between section elements: gap-10 vertical, gap-6 horizontal on grids
- DO NOT bump section padding past 5rem on mobile or 8rem on desktop — that wastes scroll and feels lazy, not generous

SHADOWS
- DO NOT use drop shadows on this vibe. Replace EVERY box-shadow with an inset 1px border trick: \`box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset\`
- Exception: hovers can briefly use a 0 0 0 1px rgba(94,106,210,0.4) inset for indigo glow on focus

BORDER RADIUS
- buttons: 6px
- cards / surfaces: 8px
- inputs: 6px
- pill (only for tags/badges): 9999px ok in tags only
- NEVER pill buttons

SIGNATURE ELEMENTS
- Gradient seams between sections: a 1px line that fades — \`background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)\`. Use this INSTEAD of solid border-t between sections.
- Hero treatment: large display heading (text-5xl mobile, md:text-7xl), the brand promise in 1 sentence, with the accent color highlighting a single key word via underline or subtle dot.
- CTAs: solid indigo (#5E6AD2) background, white text (#ffffff), padding px-6 py-3, rounded-md, NO shadow, on hover slightly brighten (filter: brightness(1.08))
- Code blocks (if any): monospace font (JetBrains Mono via Google Fonts), background #161718, padding p-4, border-radius 8px

DO
- Generous vertical rhythm (lots of py- between sections)
- Tight letter-spacing on display text
- One accent color for everything that should "pop"
- Subtle inset borders instead of drop shadows
- Solid rectangular buttons (radius 6-8px)
- Mono font for code/keyboard hints

DON'T
- Drop shadows of any kind
- Multiple bright/saturated colors (Linear is monochromatic + 1 indigo)
- Decorative gradient backgrounds in sections (only as 1px seams)
- Pill-shaped CTAs (rectangular only)
- Italic fonts (oblique on serif also banned)
- Multiple body weights (stick to 400 + occasional 500)
- Large patterned backgrounds, illustrations, or stock photography
- Light mode (this vibe IS dark — if the source HTML is light, invert)

TRANSFORMATION INSTRUCTIONS
When applying this vibe to a user's existing HTML:
1. Invert color scheme: white/light backgrounds become #0a0a0a; dark text becomes #f7f8f8
2. Replace all blue/indigo/purple Tailwind classes (bg-blue-*, bg-indigo-*, text-blue-*, etc.) with #5E6AD2 accent
3. Remove all box-shadow utilities (shadow, shadow-md, shadow-lg) and replace with the inset 1px border trick
4. Tighten letter-spacing on every heading
5. Bump section padding-y by 50% (e.g., py-16 becomes py-24)
6. Replace solid border-t between sections with gradient seam divs
7. Ensure CTA buttons are rectangular with 6-8px radius, indigo bg, white text, no shadow
8. Keep all copy and content structure intact; transform only visual styling`,
};
