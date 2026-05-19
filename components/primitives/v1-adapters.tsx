// V1-block adapters — wrap the 7 high-value V1 block components from
// `lib/blocks/*` in a V3-compatible primitive interface.
//
// V1 blocks expect `{ slots, tokens }` where `tokens` is a `BlockTokens`
// object of color/font VALUES. V3 primitives expect `{ id, variant, slots }`
// and consume design tokens through CSS variables.
//
// The bridge: pass `var(--color-…)` strings AS the token values. The V1
// component writes them into inline styles, and CSS resolves them at paint
// time against the active palette emitted by preview-doc.ts.
//
// What we port and why:
//   hero/animated-gradient    → V3 has no animated headline variant
//   hero/logo-strip            → V3 Grid.logo-bar isn't a hero (no headline + CTAs)
//   pricing/two-tier-simple    → V3 only has 3-tier pricing
//   testimonials/quote-grid-3col → V3 only has masonry testimonials
//   faq/accordion              → V3 has no FAQ primitive at all
//   footer/four-col-links      → V3 has no Footer primitive at all
//   footer/minimal-row         → second Footer variant

"use client";

import type { BlockTokens } from "@/lib/blocks/types";
import { Component as AnimatedGradient } from "@/lib/blocks/hero/animated-gradient";
import { Component as LogoStrip } from "@/lib/blocks/hero/logo-strip";
import { Component as TwoTier } from "@/lib/blocks/pricing/two-tier-simple";
import { Component as QuoteGrid3 } from "@/lib/blocks/testimonials/quote-grid-3col";
import { Component as FAQAccordion } from "@/lib/blocks/faq/accordion";
import { Component as FooterFourCol } from "@/lib/blocks/footer/four-col-links";
import { Component as FooterMinimal } from "@/lib/blocks/footer/minimal-row";

// Single shared token bridge: every field maps to the corresponding V3 CSS
// variable. accentHover doesn't exist in V3 directly; we point it at the
// same accent (the visual delta is barely perceptible for the one block
// that uses it — animated-gradient's gradient mid-stop).
export const V1_TOKENS_CSS_VARS: BlockTokens = {
  bg:              "var(--primitive-section-bg, var(--color-bg))",
  surface:         "var(--color-surface)",
  surfaceElevated: "var(--color-surface-elevated)",
  border:          "var(--color-border)",
  borderStrong:    "var(--color-border-strong)",
  text:            "var(--color-fg)",
  textMuted:       "var(--color-text-muted)",
  textDim:         "var(--color-text-dim)",
  accent:          "var(--color-accent)",
  accentHover:     "var(--color-accent-strong, var(--color-accent))",
  accentFg:        "var(--color-accent-fg)",
  radius:          "var(--radius, 12px)",
  shadow:          "0 12px 32px -8px oklch(0% 0 0 / 0.12)",
  fontDisplay:     "var(--font-display, ui-sans-serif)",
  fontBody:        "var(--font-body, ui-sans-serif)",
  fontMono:        "ui-monospace, 'Geist Mono', monospace",
};

// V3 primitive wrappers: each takes `{ id, variant, slots }` (variant
// ignored — each V1 block is a single-variant primitive) and renders the
// V1 component with the shared token bridge.

interface V1AdapterProps<S> {
  id: string;
  variant: string;
  slots: S;
}

// V1 slots are intentionally dynamic — adapters wrap legacy components
// whose prop shapes vary at runtime, so `any` here is load-bearing.
type AnyV1Slots = any; // eslint-disable-line

export function V1HeroAnimatedGradient({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <AnimatedGradient slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}

export function V1HeroLogoStrip({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <LogoStrip slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}

export function V1PricingTwoTier({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <TwoTier slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}

export function V1Testimonials3Col({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <QuoteGrid3 slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}

export function V1FAQAccordion({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <FAQAccordion slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}

export function V1FooterFourCol({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <FooterFourCol slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}

export function V1FooterMinimal({ slots }: V1AdapterProps<AnyV1Slots>) {
  return <FooterMinimal slots={slots} tokens={V1_TOKENS_CSS_VARS} />;
}
