// V3 primitive type contracts. Every primitive accepts an `id`, a `variant`
// string from a fixed union, and a typed `slots` object. The orchestrator's
// writer step (Kimi K2.6 in V3) composes pages by instantiating primitives
// from this surface.
//
// Ported from claude.ai layout-primitives artifact (May 2026).

export interface CTAValue {
  label: string;
  href: string;
}

// ───────────────── Hero ─────────────────

export type HeroVariant = "centered" | "split" | "asymmetric";

export interface HeroSlots {
  eyebrow?: string;
  headline: string;
  subhead?: string;
  ctaPrimary?: CTAValue;
  ctaSecondary?: CTAValue;
  mediaUrl?: string;
  socialProof?: string;
}

export interface HeroProps {
  id: string;
  variant: HeroVariant;
  slots: HeroSlots;
}

// ───────────────── Stack ─────────────────

export type StackVariant = "vertical-cards" | "alternating-rows" | "icon-grid-3col";

export interface StackItem {
  title: string;
  body: string;
  icon?: string;
  accent?: boolean;
}

export interface StackSlots {
  eyebrow?: string;
  title?: string;
  sub?: string;
  items: StackItem[];
}

export interface StackProps {
  id: string;
  variant: StackVariant;
  slots: StackSlots;
}

// ───────────────── Split ─────────────────

export type SplitVariant = "side-by-side" | "comparison-table" | "before-after";

export interface SplitSide {
  title: string;
  body: string;
  bullets?: string[];
  mediaUrl?: string;
}

export interface SplitSlots {
  eyebrow?: string;
  title?: string;
  sub?: string;
  left: SplitSide;
  right: SplitSide;
}

export interface SplitProps {
  id: string;
  variant: SplitVariant;
  slots: SplitSlots;
}

// ───────────────── Grid ─────────────────

export type GridVariant =
  | "logo-bar"
  | "feature-3col"
  | "testimonial-masonry"
  | "stats-4-grid"
  | "pricing-3tier";

export type GridMedia =
  | { kind: "image"; src: string }
  | { kind: "icon"; name: string }
  | { kind: "text"; value: string };

export interface GridItem {
  title?: string;
  body?: string;
  media?: GridMedia;
  cta?: CTAValue;
  accent?: boolean;
  // Pricing-specific fields (only used by pricing-3tier):
  price?: string;
  period?: string;
  features?: string[];
}

export interface GridSlots {
  eyebrow?: string;
  title?: string;
  sub?: string;
  items: GridItem[];
}

export interface GridProps {
  id: string;
  variant: GridVariant;
  slots: GridSlots;
  columns?: number;
}

// ───────────────── CTA ─────────────────

export type CTAVariant = "centered-banner" | "card-form" | "gradient-banner";

export interface CTASlots {
  eyebrow?: string;
  headline: string;
  sub?: string;
  ctaPrimary: CTAValue;
  ctaSecondary?: CTAValue;
  footnote?: string;
}

export interface CTAProps {
  id: string;
  variant: CTAVariant;
  slots: CTASlots;
}

// ───────────────── Union for the writer ─────────────────

export type PrimitiveName = "Hero" | "Stack" | "Split" | "Grid" | "CTA";

export type PrimitiveInstance =
  | { id: string; primitive: "Hero";  variant: HeroVariant;  slots: HeroSlots }
  | { id: string; primitive: "Stack"; variant: StackVariant; slots: StackSlots }
  | { id: string; primitive: "Split"; variant: SplitVariant; slots: SplitSlots }
  | { id: string; primitive: "Grid";  variant: GridVariant;  slots: GridSlots; columns?: number }
  | { id: string; primitive: "CTA";   variant: CTAVariant;   slots: CTASlots };
