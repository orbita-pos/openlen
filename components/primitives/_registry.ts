// V3 primitive registry. The orchestrator's writer step picks primitives by
// name from this map; the editor reads it to render slot panels per variant.
//
// Server-renderable: each primitive is a pure render function (no hooks,
// no "use client") so the same registry works in renderToStaticMarkup and
// in the workspace iframe.

import { Hero } from "./Hero";
import { Stack } from "./Stack";
import { Split } from "./Split";
import { Grid } from "./Grid";
import { CTA } from "./CTA";
import {
  V1FAQAccordion,
  V1FooterFourCol,
  V1FooterMinimal,
  V1HeroAnimatedGradient,
  V1HeroLogoStrip,
  V1PricingTwoTier,
  V1Testimonials3Col,
} from "./v1-adapters";

export const PRIMITIVE_REGISTRY = {
  // V3 core primitives
  Hero,
  Stack,
  Split,
  Grid,
  CTA,
  // V1-derived primitives (single-variant each, see v1-adapters.tsx for
  // why each one earned a slot in the catalog)
  V1HeroAnimatedGradient,
  V1HeroLogoStrip,
  V1PricingTwoTier,
  V1Testimonials3Col,
  V1FAQAccordion,
  V1FooterFourCol,
  V1FooterMinimal,
} as const;

export type PrimitiveName = keyof typeof PRIMITIVE_REGISTRY;

export { Hero, Stack, Split, Grid, CTA };
export * from "./types";
