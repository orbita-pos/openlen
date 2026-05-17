// Demo slot content for the 17 primitive variants. Used by:
//   - /preview-v3 gallery (variants showcase)
//   - /new-v2 workspace layout picker (renders selected primitive in iframe)
//   - Eventually, the V3 AI writer's few-shot exemplars
//
// Lifted from the artifact's demo.jsx (May 2026) so the visual matches
// claude.ai's curated demo content exactly.

import type {
  CTASlots,
  GridSlots,
  HeroSlots,
  SplitSlots,
  StackSlots,
} from "@/components/primitives/types";

export const heroSlots: HeroSlots = {
  eyebrow: "New in v3",
  headline: "Beautiful landing pages, your code, $19 a month.",
  subhead:
    "OpenLen turns a 50-word brief into a self-contained HTML page that you own. No platform lock-in.",
  ctaPrimary: { label: "Generate yours", href: "#" },
  ctaSecondary: { label: "See examples", href: "#" },
  socialProof: "1,400+ landings shipped this week",
};

export const stackSlots: StackSlots = {
  eyebrow: "How it works",
  title: "A brief in. A page out. Yours forever.",
  sub:
    "OpenLen runs locally or self-hosted. The output is plain HTML with your code, your CSS, your hosting. Nothing phones home.",
  items: [
    {
      title: "50-word brief",
      body: "Describe the page in plain English. OpenLen picks primitives, copy, and palette in one pass.",
      icon: "wand",
    },
    {
      title: "Compose, don't generate",
      body:
        "Sections snap to 5 layout primitives with strict slots. No hallucinated divs, no rogue inline styles.",
      icon: "layers",
      accent: true,
    },
    {
      title: "Edit in place",
      body:
        "Click any text or image in the live preview to edit it. Changes write back to the same source file.",
      icon: "spark",
    },
    {
      title: "Ship the HTML",
      body:
        "Download a self-contained folder or push to your repo. AGPL means you own every line of output.",
      icon: "code",
    },
  ],
};

export const splitSlots: SplitSlots = {
  eyebrow: "OpenLen vs. closed tools",
  title: "The page belongs to you.",
  sub: "Side-by-side, where the generators stop and the platforms start.",
  left: {
    title: "The closed-source path",
    body:
      "Lovable, v0, and Framer hide the output behind a dashboard. The moment you stop paying, the page goes dark.",
    bullets: [
      "Subscription gates publishing",
      "Output is JSX you can't fully export",
      "Vendor controls the runtime",
      "No self-host story",
    ],
  },
  right: {
    title: "The OpenLen path",
    body:
      "OpenLen writes static HTML to disk. Run it on a $5 VPS, drop it in your Next.js app, or commit it to git — same file either way.",
    bullets: [
      "AGPL output you own forever",
      "Plain HTML + CSS + your fonts",
      "Works offline, works in 2031",
      "Self-host or use ours: same engine",
    ],
  },
};

export const beforeAfterSlots: SplitSlots = {
  eyebrow: "The workflow",
  title: "From brief to shipped in eleven minutes.",
  sub: "What used to be a Monday-to-Wednesday project becomes a coffee.",
  left: {
    title: "Hand-rolling a landing page",
    body: "Six tabs open. Three abandoned color palettes. Tailwind UI subscription expired again.",
  },
  right: {
    title: "The same page with OpenLen",
    body: "One brief, one Generate, one round of edits. Live URL before the latte goes cold.",
  },
};

export const featureSlots: GridSlots = {
  eyebrow: "Built for the long tail",
  title: "Boring infrastructure for un-boring pages.",
  sub: "OpenLen is unapologetically opinionated about the parts that don't need creativity.",
  items: [
    {
      title: "Type-safe slots",
      body: "Every primitive declares its content shape. No prop drilling, no untyped string soup.",
      media: { kind: "icon", name: "shield" },
    },
    {
      title: "Brand from one hue",
      body:
        "Set a single OKLCH hue and the whole page calibrates. Light, dark, and high-contrast for free.",
      media: { kind: "icon", name: "spark" },
      accent: true,
    },
    {
      title: "Ships static HTML",
      body: "No runtime JavaScript required. Drop the folder on any host. Lighthouse 100 by default.",
      media: { kind: "icon", name: "bolt" },
    },
  ],
};

export const testimonialSlots: GridSlots = {
  eyebrow: "Receipts",
  title: "Used by people who write the docs you read.",
  sub: "A small but loud sample of OpenLen's first-month adopters.",
  items: [
    {
      title: "Mira Adeyemi",
      media: { kind: "text", value: "Engineering Lead · Lattice" },
      body:
        "We replaced four marketing-page Notion docs with OpenLen. Page builds are now a PR review instead of a meeting.",
    },
    {
      title: "Jonas Petrov",
      media: { kind: "text", value: "Indie hacker · zsh.tools" },
      body:
        "Shipped my launch page Saturday morning. Built three more by Sunday lunch. The brief-to-page loop is unreasonably fast.",
    },
    {
      title: "Sarah Quan",
      media: { kind: "text", value: "Founder · Daybook" },
      body:
        "The output is the kind of clean HTML I'd hand to a junior dev. No vendor div soup. Read like a designer wrote it.",
      accent: true,
    },
    {
      title: "Etan Roux",
      media: { kind: "text", value: "Staff Designer · Plural" },
      body: "It's the first AI tool I've used that respects type rhythm. Restraint over decoration — finally.",
    },
    {
      title: "Wei-Lin Chen",
      media: { kind: "text", value: "Solo founder · Boxlet" },
      body: "Replaced a $400/mo agency retainer with $19. The agency was nicer at lunch but slower at everything else.",
    },
    {
      title: "Ola Brandt",
      media: { kind: "text", value: "VP Marketing · Filed" },
      body: "Self-hosting was the dealbreaker for legal. OpenLen on our VPS shipped in an afternoon.",
    },
  ],
};

export const statsSlots: GridSlots = {
  eyebrow: "By the numbers",
  title: "What 'shipped' looks like at month four.",
  items: [
    {
      title: "Pages generated",
      media: { kind: "text", value: "182,000" },
      body: "Since the public beta opened in February.",
    },
    {
      title: "Avg. time to ship",
      media: { kind: "text", value: "11 min" },
      body: "Brief submitted to live URL, p50 across paying users.",
    },
    {
      title: "Lighthouse perf",
      media: { kind: "text", value: "98 / 100" },
      body: "Median across the last 1,000 generated pages.",
    },
    {
      title: "Self-hosted",
      media: { kind: "text", value: "3,400+" },
      body: "Independent OpenLen instances pinging the registry.",
    },
  ],
};

export const logoSlots: GridSlots = {
  title: "Trusted by teams building quietly",
  items: ["Lattice", "Plural", "Filed", "Daybook", "Boxlet", "zsh.tools", "Verge·", "Crowdcast"].map(
    (x) => ({ title: x, media: { kind: "text" as const, value: x } }),
  ),
};

export const pricingSlots: GridSlots = {
  eyebrow: "Pricing",
  title: "One number. Two tiers when you outgrow it.",
  sub: "Cancel anytime. All output is yours under AGPL — even after you leave.",
  items: [
    {
      title: "Free",
      price: "$0",
      period: "/forever",
      body: "Self-host the open-source build. Generate as many pages as you can run.",
      features: [
        "Unlimited self-hosted pages",
        "All 5 layout primitives",
        "Brand-hue theming",
        "Community Discord",
      ],
      cta: { label: "Clone the repo", href: "#" },
      media: { kind: "text", value: "AGPL" },
    },
    {
      title: "Pro",
      price: "$19",
      period: "/month",
      body: "Hosted runtime. Live edit in the browser. The default for most teams.",
      features: [
        "Hosted generator + editor",
        "Unlimited brief generations",
        "Custom fonts + favicons",
        "Email + slack support",
        "Export to any static host",
        "Brand kit syncing",
      ],
      cta: { label: "Start free trial", href: "#" },
      accent: true,
      media: { kind: "text", value: "Popular" },
    },
    {
      title: "Studio",
      price: "$49",
      period: "/month",
      body: "For agencies running OpenLen on behalf of multiple clients.",
      features: [
        "10 client workspaces",
        "Shared brand kits",
        "White-label preview URLs",
        "Priority generation queue",
        "SSO + audit log",
        "Quarterly design review",
      ],
      cta: { label: "Talk to us", href: "#" },
      media: { kind: "text", value: "Agencies" },
    },
  ],
};

export const ctaCenteredSlots: CTASlots = {
  eyebrow: "Try it",
  headline: "Write the brief. Let OpenLen ship the page.",
  sub: "Free to self-host. $19 a month for the hosted runtime. Cancel any time.",
  ctaPrimary: { label: "Generate a page", href: "#" },
  ctaSecondary: { label: "Read the docs", href: "#" },
  footnote: "No credit card required for the 14-day trial.",
};

export const ctaCardSlots: CTASlots = {
  eyebrow: "Weekly digest",
  headline: "Five briefs, five pages, every Friday.",
  sub: "We turn five reader-submitted briefs into pages each week and ship the breakdown to your inbox.",
  ctaPrimary: { label: "Subscribe", href: "#" },
  footnote: "12,000 designers and indie devs. Unsubscribe in one click.",
};

export const ctaGradientSlots: CTASlots = {
  eyebrow: "Ready when you are",
  headline: "Ship the page you've been meaning to ship.",
  sub: "Fourteen days free, all 5 primitives, every export format. The only thing you have to bring is the brief.",
  ctaPrimary: { label: "Generate yours", href: "#" },
  ctaSecondary: { label: "See the spec", href: "#" },
  footnote: "AGPL · brandHue 12 · v3.2.0",
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout registry — the 17 primitive variants mapped to their demo slots.
// Used by the workspace v2 layout picker + /api/render-layout endpoint.
// ─────────────────────────────────────────────────────────────────────────────

export type LayoutSlotsFor<P extends string> = P extends "Hero"
  ? HeroSlots
  : P extends "Stack"
    ? StackSlots
    : P extends "Split"
      ? SplitSlots
      : P extends "Grid"
        ? GridSlots
        : P extends "CTA"
          ? CTASlots
          : never;

export interface LayoutPreset {
  id: string;
  primitive: "Hero" | "Stack" | "Split" | "Grid" | "CTA";
  variant: string;
  label: string;
  group: "Hero" | "Stack" | "Split" | "Grid" | "CTA";
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "hero-centered",         primitive: "Hero",  variant: "centered",           label: "Centered",          group: "Hero" },
  { id: "hero-split",            primitive: "Hero",  variant: "split",              label: "Split",             group: "Hero" },
  { id: "hero-asymmetric",       primitive: "Hero",  variant: "asymmetric",         label: "Asymmetric",        group: "Hero" },
  { id: "stack-vertical-cards",  primitive: "Stack", variant: "vertical-cards",     label: "Vertical cards",    group: "Stack" },
  { id: "stack-alternating",     primitive: "Stack", variant: "alternating-rows",   label: "Alternating rows",  group: "Stack" },
  { id: "stack-icon-grid",       primitive: "Stack", variant: "icon-grid-3col",     label: "Icon grid 3-col",   group: "Stack" },
  { id: "split-side-by-side",    primitive: "Split", variant: "side-by-side",       label: "Side-by-side",      group: "Split" },
  { id: "split-comparison",      primitive: "Split", variant: "comparison-table",   label: "Comparison table",  group: "Split" },
  { id: "split-before-after",    primitive: "Split", variant: "before-after",       label: "Before / After",    group: "Split" },
  { id: "grid-logo-bar",         primitive: "Grid",  variant: "logo-bar",           label: "Logo bar",          group: "Grid" },
  { id: "grid-feature-3col",     primitive: "Grid",  variant: "feature-3col",       label: "Feature 3-col",     group: "Grid" },
  { id: "grid-testimonials",     primitive: "Grid",  variant: "testimonial-masonry",label: "Testimonial masonry",group: "Grid" },
  { id: "grid-stats-4",          primitive: "Grid",  variant: "stats-4-grid",       label: "Stats 4-grid",      group: "Grid" },
  { id: "grid-pricing-3",        primitive: "Grid",  variant: "pricing-3tier",      label: "Pricing 3-tier",    group: "Grid" },
  { id: "cta-centered",          primitive: "CTA",   variant: "centered-banner",    label: "Centered banner",   group: "CTA" },
  { id: "cta-card-form",         primitive: "CTA",   variant: "card-form",          label: "Card form",         group: "CTA" },
  { id: "cta-gradient",          primitive: "CTA",   variant: "gradient-banner",    label: "Gradient banner",   group: "CTA" },
];

// Look up demo slots for any (primitive, variant) combination.
export function getDemoSlots(primitive: string, variant: string): unknown {
  if (primitive === "Hero") return heroSlots;
  if (primitive === "Stack") {
    if (variant === "icon-grid-3col") return { ...stackSlots, items: stackSlots.items.slice(0, 3) };
    return stackSlots;
  }
  if (primitive === "Split") {
    if (variant === "comparison-table") {
      return {
        ...splitSlots,
        title: "OpenLen vs. Lovable, feature by feature.",
        sub: "Same job, two opposite philosophies.",
      };
    }
    if (variant === "before-after") return beforeAfterSlots;
    return splitSlots;
  }
  if (primitive === "Grid") {
    if (variant === "logo-bar") return logoSlots;
    if (variant === "feature-3col") return featureSlots;
    if (variant === "testimonial-masonry") return testimonialSlots;
    if (variant === "stats-4-grid") return statsSlots;
    if (variant === "pricing-3tier") return pricingSlots;
  }
  if (primitive === "CTA") {
    if (variant === "card-form") return ctaCardSlots;
    if (variant === "gradient-banner") return ctaGradientSlots;
    return ctaCenteredSlots;
  }
  return null;
}
