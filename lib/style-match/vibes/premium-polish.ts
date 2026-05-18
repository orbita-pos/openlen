import type { VibeBrief } from "./types";

export const premiumPolish: VibeBrief = {
  id: "premium-polish",
  name: "Premium Polish",
  nameEs: "Pulido Premium",
  tagline: "Apple-grade restraint. Centered hero. Extreme whitespace.",
  taglineEs: "Restricción nivel Apple. Hero centrado. Espacio en blanco extremo.",
  inspiration: "Apple, Things app, Bear app, Vision Pro marketing",
  preview: { bg: "#ffffff", fg: "#1d1d1f", accent: "#0066cc" },
  brief: `VIBE: Premium Polish — Apple-grade minimalist luxury

CORE PHILOSOPHY
The page communicates premium consumer product. Extreme whitespace gives every element room to breathe. Centered compositions. Massive product-photography-style hero (whether or not there's actual product). Tight-tracked SF-style display typography. Restrained Apple-blue accent used in 1-2 places max. Every choice signals "we charge a premium because we think this carefully about details."

COLORS (use exactly these)
- Background: #ffffff (pure white)
- Foreground / body text: #1d1d1f (Apple's signature near-black with slight warmth)
- Accent: #0066cc (Apple blue, used sparingly: link color, focus rings, occasionally a "Learn more" inline link)
- Surface raised: #f5f5f7 (Apple's signature off-white for alternate sections)
- Muted (secondary text): #86868b
- Border (extremely subtle): #d2d2d7
- Optional sub-accent for callouts: #1d1d1f darker variant

TYPOGRAPHY
- Family: 'SF Pro Display' for headings, 'SF Pro Text' for body — but these aren't on Google Fonts. Declare a system fallback: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif. On non-Apple devices, falls back to system-ui or Helvetica — that's intentional. The vibe still translates.
- Optional Google Fonts replacement: 'Inter' with letter-spacing tweaks to mimic SF feel
- Mono (if needed for code): 'SF Mono', 'JetBrains Mono', monospace
- Scale ratio: 1.333 (perfect fourth) → sizes 14, 17, 19, 24, 32, 48, 64, 88
- Weights: 400 body, 500 medium-emphasis, 600 semibold for headings (NEVER 700+ — Apple stays at 600 max for display)
- Letter-spacing: SF Pro Display gets aggressive negative tracking on display: -0.04em on h1, -0.03em on h2, -0.02em on h3, 0em on body
- Line-height: 1.05 on hero display (very tight), 1.2 on h2-h3, 1.5 on body

SPACING
- Base unit: 4px
- Section padding-y: GENEROUS — py-24 mobile, md:py-32 lg:py-40 lg:py-48 (more than Technical Dark)
- Container max-width: max-w-5xl (1024px) for content; full-bleed for hero
- Hero takes 80-100vh on desktop, with centered composition
- Extreme whitespace between hero elements (hero heading mb-12, subhead mb-16 before CTA)

SHADOWS — subtle, premium-feeling
- Cards: \`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.03)\`
- Floating elements (rare): \`box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1), 0 4px 12px rgba(0, 0, 0, 0.05)\`
- Hover: shadow grows slightly + element lifts 2px
- Transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1)

BORDER RADIUS — Apple-style generous
- Buttons: 12px (Apple's standard) or 980px (pill, also Apple's standard for some CTAs)
- Cards: 18px (Apple's signature large card radius)
- Inputs: 12px
- Product visuals / hero images: 22px (Apple uses very large radii on product photography)
- Use 18px+ on raised cards — generous radius is part of the premium feel

SIGNATURE ELEMENTS
- Hero treatment: CENTERED (Apple is centered, unlike most other vibes). Display heading text-5xl mobile, md:text-7xl, lg:text-8xl. Weight 600, letter-spacing -0.04em, line-height 1.05. Subhead in muted text (~text-xl, weight 400). Single CTA below, either solid #0066cc with white text rounded-full (Apple's pill CTA) OR an underlined "Learn more →" text link in Apple blue.
- CTAs: choose ONE style:
  - Pill primary: rounded-full, bg-[#0066cc], text-white, px-6 py-2.5, no shadow, hover slightly darken
  - Outlined: border-2 border-[#0066cc], text-[#0066cc], bg-transparent, rounded-full, same padding
  - Text link: text-[#0066cc] with right-arrow → after, no underline by default, underline-on-hover
- Subsection callouts: text-sm uppercase tracking-widest [0.1em] in muted color — Apple's signature "TINY LABELS ABOVE BIG HEADINGS" pattern
- Product image treatments: large product photograph centered in section, rounded-3xl (22px), subtle shadow, 2-line caption below
- Feature grids: alternating #ffffff and #f5f5f7 backgrounds between sections (subtle but distinct)
- Pricing display: large numbers (text-5xl), small currency symbol superscript, label small below

DO
- CENTERED hero composition (this is THE signature)
- Extreme tight tracking on display headings (-0.04em on h1)
- Generous whitespace between every element (extra mt-/mb- everywhere)
- 18-22px radius on cards / product visuals (large, Apple-like)
- Tiny uppercase tracked labels above big headings
- Alternating white / off-white #f5f5f7 sections
- Apple-blue link/CTA, restrained use
- Apple-blue ONLY in 1-2 specific places (link, primary CTA) — not littered everywhere

DON'T
- Left-aligned hero (Apple is centered)
- Heavy bold weights (max 600, never 700+)
- Multiple competing colors (Apple is monochromatic + 1 blue)
- Sharp corners (everything has radius)
- Heavy drop shadows (subtle premium-feeling only)
- Cramped layouts (extreme whitespace is the rule)
- Decorative gradients, illustrations, or stock photo overlays
- Dark mode primary (this vibe is daylight white)

TRANSFORMATION INSTRUCTIONS
When applying this vibe to a user's existing HTML:
1. Background to white #ffffff, text to Apple-black #1d1d1f
2. Replace any blue/colored accents with Apple-blue #0066cc, but USE IT SPARINGLY (only 1-2 places: primary CTA + main link color)
3. Center the hero heading and CTA (text-center + mx-auto on container)
4. Bump display heading sizes significantly: text-5xl → text-7xl on lg, etc.
5. Tighten letter-spacing aggressively on headings (-0.04em on h1, -0.03em on h2, -0.02em on h3)
6. Reduce heading weights to 600 max (font-bold → font-semibold)
7. Bump all border-radius up: rounded-md → rounded-xl (12px), rounded-lg → rounded-2xl (18px), rounded-xl → rounded-3xl (22px)
8. Bump section padding-y by ~50% (e.g., py-20 becomes py-32, py-24 becomes py-40)
9. Convert solid colored buttons to either pill (rounded-full) or text-link with → arrow
10. Add tiny uppercase tracked labels (text-sm uppercase tracking-widest) above main section headings if context allows
11. Alternate section backgrounds white / #f5f5f7 if multiple sections exist
12. Replace heavy shadows with the subtle premium-feeling versions
13. Keep all copy and structure intact`,
};
