// Workspace v2 demo + adapter data.
//
// The PRESETS (backgrounds, palettes, typography) now derive from the
// canonical design system at `lib/design/presets/*` — same source-of-truth
// that powers `/preview-v3` and (eventually) the V3 AI-generated landings.
// The shapes below keep the UI components (design-panel, thumbs, preview-doc)
// happy without forcing them to refactor.
//
// The workspace-specific demo data (SECTIONS, MOCK_PROJECTS, ACTIVITY_LOG,
// INITIAL_CHAT) stays mock because it's preview-iframe content, not part of
// the design system.

import {
  BACKGROUND_PRESETS,
} from "@/lib/design/presets/backgrounds";
import {
  PALETTE_PRESETS,
  generatePalette,
} from "@/lib/design/presets/palettes";
import {
  TYPOGRAPHY_PRESETS,
} from "@/lib/design/presets/typography";

// ─────────────────────────────────────────────────────────────────────────────
// Section demo content (preview iframe — not part of the design system)
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionField {
  [key: string]: unknown;
}

export interface Section {
  id: string;
  name: string;
  variant: string;
  icon: string;
  fields: SectionField;
}

export const SECTIONS: Section[] = [
  {
    id: "hero",
    name: "Hero",
    variant: "centered",
    icon: "Sparkles",
    fields: {
      eyebrow: "v2 — now with edge runtime",
      heading: "Ship serverless in one command.",
      subheading:
        "Deploy to 280 edge regions. Zero config. Pay only for what you use, in 134 currencies.",
      ctaPrimaryLabel: "Start free",
      ctaPrimaryUrl: "/start",
      ctaSecondaryLabel: "Read the docs",
      ctaSecondaryUrl: "/docs",
    },
  },
  {
    id: "logobar",
    name: "Logo Bar",
    variant: "split",
    icon: "Image",
    fields: {
      caption: "Trusted by teams shipping fast",
      logos: ["Linear", "Vercel", "Cal.com", "Resend", "Plain", "Liveblocks"],
    },
  },
  {
    id: "features",
    name: "Features Split",
    variant: "asymmetric",
    icon: "Layers",
    fields: {
      eyebrow: "What's inside",
      heading: "Built for the people who actually deploy.",
      items: [
        { title: "One command", body: "npx acme deploy. That's it.", icon: "Zap" },
        { title: "Edge by default", body: "280 regions worldwide. No knobs to turn.", icon: "Globe" },
        { title: "Pay what you use", body: "Per-invocation billing, no idle costs, no ramp.", icon: "CircleDollar" },
      ],
    },
  },
  {
    id: "pricing",
    name: "Pricing",
    variant: "3-tier",
    icon: "CircleDollar",
    fields: {
      heading: "Priced for builders.",
      tiers: [
        { name: "Hobby", price: "$0", blurb: "Side projects and learning.", featured: false },
        { name: "Pro", price: "$19", blurb: "Indie devs and weekend tools.", featured: true },
        { name: "Team", price: "$49", blurb: "Up to 10 collaborators.", featured: false },
      ],
    },
  },
  {
    id: "faq",
    name: "FAQ",
    variant: "centered",
    icon: "HelpCircle",
    fields: {
      heading: "Frequently asked.",
      items: [
        { q: "Is there a free tier?", a: "Yes — Hobby plan, generous limits, no card." },
        { q: "Do you support custom domains?", a: "Free on Pro and above; one click to attach." },
        { q: "Can I self-host?", a: "Yes, the runtime is AGPL." },
      ],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND PRESETS — { id, label } derived from BACKGROUND_PRESETS.
// The real Component lives in lib/design/presets/backgrounds.tsx and is
// looked up by id in components/workspace-v2/thumbs.tsx.
// ─────────────────────────────────────────────────────────────────────────────

export interface BackgroundPreset {
  id: string;
  label: string;
}

export const BG_PRESETS: BackgroundPreset[] = BACKGROUND_PRESETS.map((b) => ({
  id: b.id,
  label: b.name,
}));

// ─────────────────────────────────────────────────────────────────────────────
// PALETTES — adapter over PALETTE_PRESETS + generatePalette().
// The swatch UI shows 3 stacked color bars; we pick {accent, surfaceElevated, fg}
// from the full 10-token palette to give visual variety.
// The iframe CSS reads brand/accent/neutral; we map them similarly.
// ─────────────────────────────────────────────────────────────────────────────

export interface Palette {
  id: string;
  hue: number;
  mode: "light" | "dark";
  /** Vibrant accent — the punchy brand color (used on CTAs + headline spans) */
  brand: string;
  /** A secondary tone — keeps swatch + iframe distinct from `brand` */
  accent: string;
  /** Darkest text token (used as wordmark mark bg, body text) */
  neutral: string;
  /** Five swatch colors for the visual preview (richest representation) */
  swatch: string[];
}

export const PALETTES: Palette[] = PALETTE_PRESETS.map((spec) => {
  const p = generatePalette(spec.brandHue, spec.mode);
  return {
    id: spec.id,
    hue: spec.brandHue,
    mode: spec.mode,
    // Three semantic roles read by preview-doc.ts
    brand: p.accent,
    accent: p.fgMuted,
    neutral: p.fg,
    // Five-color richer swatch for the design panel UI: surface → border-strong → fgMuted → fg → accent
    swatch: [p.surface, p.borderStrong, p.fgMuted, p.fg, p.accent],
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPOGRAPHY SYSTEMS — adapter over TYPOGRAPHY_PRESETS.
// ─────────────────────────────────────────────────────────────────────────────

export interface TypeSystem {
  id: string;
  label: string;
  family: string;
  weight: number;
  tracking: string;
  sampleSize: number;
}

export const TYPE_SYSTEMS: TypeSystem[] = TYPOGRAPHY_PRESETS.map((t) => ({
  id: t.id,
  label: t.name,
  family: t.displayFamily,
  weight: t.displayWeight,
  tracking: t.displayTracking,
  // Bigger sampleSize for systems with a bigger modular scale (visual cue).
  sampleSize: Math.round(28 + (t.scale - 1.2) * 60),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Project mock list + activity log (workspace-specific demo content)
// ─────────────────────────────────────────────────────────────────────────────

export interface MockProject {
  id: string;
  name: string;
  editedAt: string;
  status: "draft" | "published";
  deploy: string | null;
  thumb: "acme" | "acmeHome" | "drift" | "lumen" | "indiecon";
}

export const MOCK_PROJECTS: MockProject[] = [
  { id: "acme-pricing", name: "Acme — Pricing Page", editedAt: "2m ago", status: "draft", deploy: null, thumb: "acme" },
  { id: "acme-home", name: "Acme — Marketing Home", editedAt: "1h ago", status: "published", deploy: "acme.openlen.com", thumb: "acmeHome" },
  { id: "drift", name: "Drift — Inbox Zero AI", editedAt: "yesterday", status: "published", deploy: "drift.openlen.com", thumb: "drift" },
  { id: "lumen", name: "Lumen — Analytics", editedAt: "2 days ago", status: "draft", deploy: null, thumb: "lumen" },
  { id: "indiecon", name: "IndieCon '26", editedAt: "1 week ago", status: "published", deploy: "indiecon26.openlen.com", thumb: "indiecon" },
];

export const DENSITY_OPTS = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "spacious", label: "Spacious" },
] as const;

export const RADIUS_OPTS = [
  { value: "sharp", label: "Sharp" },
  { value: "soft", label: "Soft" },
  { value: "pill", label: "Pill" },
] as const;

export const DECORATION_OPTS = [
  { value: "minimal", label: "Minimal" },
  { value: "balanced", label: "Balanced" },
  { value: "bold", label: "Bold" },
] as const;

export const ACTIVITY_LOG = [
  "Hero regenerated · 4s ago",
  "Pricing copy edited · 14s ago",
  "Background changed to Conic · 38s ago",
  "FAQ section added · 1m ago",
  "Palette switched to Indigo Cool · 2m ago",
];

export type DensityValue = (typeof DENSITY_OPTS)[number]["value"];
export type RadiusValue = (typeof RADIUS_OPTS)[number]["value"];
export type DecorationValue = (typeof DECORATION_OPTS)[number]["value"];

/** A single section in the composed landing. id is local to the page
 *  (e.g., "sec-1"); primitive + variant point at one of the 17 LayoutPresets. */
export interface SectionInstance {
  /** Per-page unique id so React keys + state edits target the right one. */
  id: string;
  /** LayoutPreset.id (e.g., "hero-centered", "grid-pricing-3"). Look up the
   *  primitive + variant + demo slots via LAYOUT_PRESETS. */
  layoutId: string;
}

export interface DesignState {
  bg: string;
  paletteId: string;
  hue: number;
  typeId: string;
  density: DensityValue;
  radius: RadiusValue;
  decoration: DecorationValue;
  /** Ordered list of section instances that make up the current landing.
   *  Empty array OR null means "use mock Acme landing". A non-empty array
   *  causes /api/render-layout to render each and the iframe to show them
   *  stacked top-to-bottom. */
  composition: SectionInstance[];
}

// A sensible default SaaS landing composition — 5 sections that read like
// a real product page from start to finish.
function makeId(): string {
  return `sec-${Math.random().toString(36).slice(2, 8)}`;
}

// Default composition now uses V1-derived FAQ + Footer too — a more
// realistic SaaS landing structure (hero → social proof → features →
// pricing → FAQ → CTA → footer).
export const DEFAULT_COMPOSITION: SectionInstance[] = [
  { id: makeId(), layoutId: "hero-centered" },
  { id: makeId(), layoutId: "grid-logo-bar" },
  { id: makeId(), layoutId: "stack-icon-grid" },
  { id: makeId(), layoutId: "grid-pricing-3" },
  { id: makeId(), layoutId: "faq-accordion" },
  { id: makeId(), layoutId: "cta-centered" },
  { id: makeId(), layoutId: "footer-four-col" },
];

// Initial state references real preset ids.
// First palette is "coral-editorial" (brandHue 12 = OpenLen's coral brand).
export const INITIAL_DESIGN: DesignState = {
  bg: "mesh-grain",
  paletteId: "coral-editorial",
  hue: 12,
  typeId: "geist-editorial",
  density: "standard",
  radius: "soft",
  decoration: "balanced",
  composition: DEFAULT_COMPOSITION,
};

// Stable id-generator exposed for the panel + page when they need to add
// new sections at runtime.
export { makeId as makeSectionId };

export interface ChatMessage {
  from: "ai" | "me";
  at: string;
  text: string;
  action?: string;
}

export const INITIAL_CHAT: ChatMessage[] = [
  {
    from: "ai",
    at: "12m ago",
    text:
      "Welcome back. Your Acme Pricing Page is ready — 6 sections, generated in 12s for $0.014. What would you like to refine?",
  },
  {
    from: "me",
    at: "11m ago",
    text:
      "Make the hero headline punchier and switch the pricing to two tiers instead of three.",
  },
  {
    from: "ai",
    at: "11m ago",
    text:
      "Trimmed the hero from 'Ship serverless in one command.' → 'Ship serverless. One command.' and collapsed Pricing to Hobby + Pro. Preview is updated.",
    action: "Rewrote hero · Updated pricing tiers",
  },
];
