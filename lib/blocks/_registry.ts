// ─────────────────────────────────────────────────────────────────────────────
// Block registry — single source of truth mapping block IDs → React component
// + metadata. The orchestrator's `plan.structure` step picks block IDs from
// this registry; `section.fill` produces JSON validated by each block's
// `meta.slotsSchema`; `compose.assemble` renders the chosen Component with
// validated slots + design tokens.
//
// The shape is intentionally a flat `as const` record so:
//   - `BlockId` is a literal-union type (autocomplete + exhaustive switches),
//   - `getBlock(id)` is fully typed,
//   - tree-shaking can drop unused blocks if the orchestrator only ever uses
//     a subset (e.g. on a per-template basis later).
//
// Cross-check: every block's `meta.id` must equal its key here. Adding a new
// block without updating both will surface as a type error on `id` mismatch
// once consumers narrow on it.
// ─────────────────────────────────────────────────────────────────────────────

import type { AestheticDirection } from "./types";

// ── Heroes ─────────────────────────────────────────────────────────────────
import {
  meta as heroCenteredCtaMeta,
  Component as HeroCenteredCta,
} from "./hero/centered-cta";
import {
  meta as heroSplitImageMeta,
  Component as HeroSplitImage,
} from "./hero/split-image";
import {
  meta as heroAnimatedGradientMeta,
  Component as HeroAnimatedGradient,
} from "./hero/animated-gradient";
import {
  meta as heroLogoStripMeta,
  Component as HeroLogoStrip,
} from "./hero/logo-strip";

// ── Features ───────────────────────────────────────────────────────────────
import {
  meta as featuresIconGrid3ColMeta,
  Component as FeaturesIconGrid3Col,
} from "./features/icon-grid-3col";
import {
  meta as featuresBentoAsymmetricMeta,
  Component as FeaturesBentoAsymmetric,
} from "./features/bento-asymmetric";
import {
  meta as featuresAlternatingRowsMeta,
  Component as FeaturesAlternatingRows,
} from "./features/alternating-rows";

// ── Pricing ────────────────────────────────────────────────────────────────
import {
  meta as pricingThreeTierHighlightMeta,
  Component as PricingThreeTierHighlight,
} from "./pricing/three-tier-highlight";
import {
  meta as pricingTwoTierSimpleMeta,
  Component as PricingTwoTierSimple,
} from "./pricing/two-tier-simple";

// ── Testimonials ───────────────────────────────────────────────────────────
import {
  meta as testimonialsQuoteGrid3ColMeta,
  Component as TestimonialsQuoteGrid3Col,
} from "./testimonials/quote-grid-3col";

// ── FAQ ────────────────────────────────────────────────────────────────────
import {
  meta as faqAccordionMeta,
  Component as FaqAccordion,
} from "./faq/accordion";

// ── CTA ────────────────────────────────────────────────────────────────────
import {
  meta as ctaGradientCtaMeta,
  Component as CtaGradientCta,
} from "./cta/gradient-cta";
import {
  meta as ctaCardCtaFormMeta,
  Component as CtaCardCtaForm,
} from "./cta/card-cta-form";

// ── Footer ─────────────────────────────────────────────────────────────────
import {
  meta as footerFourColLinksMeta,
  Component as FooterFourColLinks,
} from "./footer/four-col-links";
import {
  meta as footerMinimalRowMeta,
  Component as FooterMinimalRow,
} from "./footer/minimal-row";

// ─────────────────────────────────────────────────────────────────────────────
// The registry. Keys are the canonical block IDs. They MUST match each
// imported `meta.id` — a TypeScript-level guard runs at module load below.
// ─────────────────────────────────────────────────────────────────────────────

export const BLOCK_REGISTRY = {
  "hero/centered-cta": {
    meta: heroCenteredCtaMeta,
    Component: HeroCenteredCta,
  },
  "hero/split-image": {
    meta: heroSplitImageMeta,
    Component: HeroSplitImage,
  },
  "hero/animated-gradient": {
    meta: heroAnimatedGradientMeta,
    Component: HeroAnimatedGradient,
  },
  "hero/logo-strip": {
    meta: heroLogoStripMeta,
    Component: HeroLogoStrip,
  },
  "features/icon-grid-3col": {
    meta: featuresIconGrid3ColMeta,
    Component: FeaturesIconGrid3Col,
  },
  "features/bento-asymmetric": {
    meta: featuresBentoAsymmetricMeta,
    Component: FeaturesBentoAsymmetric,
  },
  "features/alternating-rows": {
    meta: featuresAlternatingRowsMeta,
    Component: FeaturesAlternatingRows,
  },
  "pricing/three-tier-highlight": {
    meta: pricingThreeTierHighlightMeta,
    Component: PricingThreeTierHighlight,
  },
  "pricing/two-tier-simple": {
    meta: pricingTwoTierSimpleMeta,
    Component: PricingTwoTierSimple,
  },
  "testimonials/quote-grid-3col": {
    meta: testimonialsQuoteGrid3ColMeta,
    Component: TestimonialsQuoteGrid3Col,
  },
  "faq/accordion": {
    meta: faqAccordionMeta,
    Component: FaqAccordion,
  },
  "cta/gradient-cta": {
    meta: ctaGradientCtaMeta,
    Component: CtaGradientCta,
  },
  "cta/card-cta-form": {
    meta: ctaCardCtaFormMeta,
    Component: CtaCardCtaForm,
  },
  "footer/four-col-links": {
    meta: footerFourColLinksMeta,
    Component: FooterFourColLinks,
  },
  "footer/minimal-row": {
    meta: footerMinimalRowMeta,
    Component: FooterMinimalRow,
  },
} as const;

export type BlockId = keyof typeof BLOCK_REGISTRY;

export const BLOCK_IDS = Object.keys(BLOCK_REGISTRY) as BlockId[];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a block by ID. Returns `{ meta, Component }`. Throws (in dev) if the
 * ID is not in the registry — production callers should pre-validate with
 * `isBlockId`.
 */
export function getBlock<Id extends BlockId>(id: Id) {
  const entry = BLOCK_REGISTRY[id];
  if (!entry) {
    throw new Error(`[blocks/_registry] Unknown block id: ${String(id)}`);
  }
  return entry;
}

export function isBlockId(id: string): id is BlockId {
  return id in BLOCK_REGISTRY;
}

/**
 * Returns every block ID whose meta declares it fits the given aesthetic
 * direction. Used by the plan step to constrain the AI's pick list.
 */
export function blocksForAesthetic(aesthetic: AestheticDirection): BlockId[] {
  return BLOCK_IDS.filter((id) =>
    BLOCK_REGISTRY[id].meta.aesthetics.includes(aesthetic)
  );
}

/**
 * Returns every block ID under the given category prefix, e.g.
 * `blocksOfType("hero")` → `["hero/centered-cta", "hero/split-image", …]`.
 *
 * Useful for the plan step: "give me all heroes" rather than enumerating.
 */
export function blocksOfType(prefix: string): BlockId[] {
  const needle = `${prefix}/`;
  return BLOCK_IDS.filter((id) => id.startsWith(needle));
}

/**
 * Returns every block ID matching BOTH a category prefix AND an aesthetic.
 * The most common pick-list call from the plan step.
 */
export function blocksOfTypeForAesthetic(
  prefix: string,
  aesthetic: AestheticDirection
): BlockId[] {
  return blocksOfType(prefix).filter((id) =>
    BLOCK_REGISTRY[id].meta.aesthetics.includes(aesthetic)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-load sanity check: every registry key must match its block's meta.id.
// This is the cheapest possible cross-check — runs once per process import.
// ─────────────────────────────────────────────────────────────────────────────

for (const id of BLOCK_IDS) {
  const declared = BLOCK_REGISTRY[id].meta.id;
  if (declared !== id) {
    throw new Error(
      `[blocks/_registry] meta.id mismatch: registry key "${id}" ` +
        `but the block declares meta.id="${declared}". Fix one of them.`
    );
  }
}
