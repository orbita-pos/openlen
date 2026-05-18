import type { VibeBrief } from "./types";

export const modernFintech: VibeBrief = {
  id: "modern-fintech",
  name: "Modern Fintech",
  nameEs: "Fintech Moderno",
  tagline: "Crisp white. Indigo accent. Subtle layered shadows.",
  taglineEs: "Blanco impecable. Acento índigo. Sombras suaves en capas.",
  inspiration: "Stripe, Mercury, Ramp, Plaid",
  preview: { bg: "#ffffff", fg: "#0a2540", accent: "#635bff" },
  brief: `VIBE: Modern Fintech — Crisp professional with subtle layered depth

CORE PHILOSOPHY
A pristine, trustworthy, professional surface. Bright white canvas, deep navy text, signature indigo accent. The page communicates "we handle money, so we look meticulous." Subtle gradient hero. Layered soft shadows that suggest premium-feeling depth without screaming. Every spec sheet number gets equal-monospace alignment.

COLORS (use exactly these)
- Background: #ffffff (pure white)
- Foreground / body text: #0a2540 (deep navy, more readable than pure black)
- Accent: #635bff (Stripe's signature indigo — used for: primary CTA fill, link color, focus rings, highlight on hover, gradient hero)
- Surface raised (cards): #ffffff with shadow + thin border #e3e8ee
- Muted (secondary text): #425466
- Border: #e3e8ee (cool gray with slight blue tint)
- Secondary accent (for variation, used rarely): #00d4ff (cyan) — only in gradients alongside indigo
- Success: #3ec39d (mint green) — for success states only

TYPOGRAPHY
- Family: Inter via Google Fonts variable (weights 400, 500, 600, 700)
- Optional display: 'Sohne' or 'Camphor' if you can, else Inter weight 600
- Mono for numbers / API code: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace
- Scale ratio: major second 1.125 → sizes 14, 16, 18, 20, 24, 28, 32, 40, 56
- Weights: 400 body, 500 emphasis, 600 medium headings, 700 display headings
- Letter-spacing: -0.011em on display headings, -0.006em on body
- Line-height: 1.15 on display, 1.3 on h3-h4, 1.55 on body paragraphs

SPACING
- Base unit: 4px
- Section padding-y: balanced — py-20 mobile, md:py-24 lg:py-28
- Container max-width: max-w-6xl (1152px) for content; full-bleed for gradient hero with internal max-w-6xl wrapper
- Two-column hero common (left text, right product mockup) at lg+; stacks vertically on mobile

SHADOWS — the Stripe signature layered look
- Use 2-3 layer shadows for cards, all with subtle blue tint:
  \`box-shadow: 0 0 0 1px rgba(50, 50, 93, 0.06), 0 4px 8px rgba(50, 50, 93, 0.06), 0 4px 8px rgba(0, 0, 0, 0.04)\`
- For raised CTAs / floating elements:
  \`box-shadow: 0 4px 16px rgba(99, 91, 255, 0.15), 0 1px 2px rgba(0, 0, 0, 0.04)\`
- For hover state on cards:
  \`box-shadow: 0 0 0 1px rgba(50, 50, 93, 0.1), 0 8px 24px rgba(50, 50, 93, 0.1), 0 4px 12px rgba(0, 0, 0, 0.04)\`
- Transition shadows smoothly: transition: box-shadow 0.18s ease

BORDER RADIUS
- Buttons: 8px (slightly rounded but not pill)
- Cards: 12px
- Inputs: 8px
- Pill (only for tags/badges, NOT primary CTAs): 9999px

SIGNATURE ELEMENTS
- Hero treatment: subtle gradient backdrop \`linear-gradient(135deg, #00d4ff 0%, #635bff 100%)\` with white text overlay OR white background with gradient text on key headline. Two-column layout: heading + CTA on left, product mockup screenshot on right.
- CTAs: solid indigo (#635bff), white text, 8px radius, 16-18px font-medium, generous padding (px-6 py-3 or px-8 py-4), with the indigo glow shadow listed above. On hover, brighten slightly.
- Helper text below inputs (text-sm, muted color) explaining what's expected
- Feature cards: white background, subtle layered shadow, 12px radius, 24-32px padding, small icon at top (indigo or gradient)
- "Status badges": small pills (rounded-full) with colored bg + colored text (e.g., bg-green-50 text-green-700 for "Active")
- Code/API snippets if applicable: monospace, dark mode block within light page

DO
- Layered shadows with cool blue tint (multiple shadow layers stacked)
- Subtle indigo gradient hero
- Helper text below form inputs
- Two-column hero layout (text + visual)
- Solid colored CTAs with indigo glow shadow
- Generous spacing within cards (24-32px padding)
- Monospace for any number / code element

DON'T
- Flat designs without any shadow (this vibe lives off the layered shadow signature)
- Dark mode primary (always light)
- Pill-shaped buttons (8-12px radius rectangles)
- Heavy black borders (everything is light, subtle)
- Decorative illustrations from generic free libraries (use product screenshots instead)
- Bright multiple-color palettes (indigo is the only saturated color; cyan only in gradients)

TRANSFORMATION INSTRUCTIONS
When applying this vibe to a user's existing HTML:
1. Background to white #ffffff, text to navy #0a2540
2. Replace all Tailwind blue/indigo/purple variants with #635bff accent (bg-blue-* → bg-[#635bff], text-blue-* → text-[#635bff])
3. Add the Stripe-style layered shadows to every card / feature box / pricing tier
4. Add a subtle gradient backdrop to the hero section (or gradient text on the hero headline)
5. Convert button styles: rounded-md → rounded-lg (8-12px), add the indigo glow shadow
6. Increase letter-spacing slightly negative on headings
7. Convert any centered hero to left-aligned with right-column slot for product visual
8. Add helper text below form inputs where contextually possible
9. Keep all copy and structure`,
};
