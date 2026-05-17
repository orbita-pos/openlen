// /preview-v3 — renders all V3 design assets for visual validation.
//
// Top: design foundations (8 backgrounds, 5 SVG decorations, 20 palettes).
// Middle: 17 layout primitive variants with TOC.
// Bottom: registry export block.
//
// Server-rendered. No client interaction (yet). The workspace will
// eventually drive these via state — for now this is a static gallery
// to confirm the port renders correctly in the OpenLen runtime.

import type { ReactNode } from "react";
import "./tokens.css";

import {
  BACKGROUND_PRESETS,
  MeshGrain,
  type BackgroundSpec,
} from "@/lib/design/presets/backgrounds";
import {
  DECORATION_PRESETS,
  type DecorationSpec,
} from "@/lib/design/presets/decorations";
import {
  PALETTE_PRESETS,
  generatePalette,
  validatePalette,
  type PaletteSpec,
} from "@/lib/design/presets/palettes";
import {
  TYPOGRAPHY_PRESETS,
  buildTypographyStylesheet,
  type TypographySpec,
} from "@/lib/design/presets/typography";

import { Hero } from "@/components/primitives/Hero";
import { Stack } from "@/components/primitives/Stack";
import { Split } from "@/components/primitives/Split";
import { Grid } from "@/components/primitives/Grid";
import { CTA } from "@/components/primitives/CTA";

// ─────────────────────────────────────────────────────────────────────────────
// Demo content — same as the artifact's demo.jsx so we render exactly what
// claude.ai showed.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_HUE = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Chrome — shared header/wordmark/stats/footer components mirroring the
// original Design Foundations + Typography Systems artifacts.
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  meta,
  description,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 max-w-6xl mb-10">
      <div>
        <div
          className="text-[11px] font-mono uppercase tracking-[0.18em] mb-2"
          style={{ color: "var(--color-text-dim)" }}
        >
          {eyebrow}
        </div>
        <h2
          className="text-[42px] leading-[1.02] tracking-[-0.025em] font-semibold font-display"
          style={{ color: "var(--color-fg)" }}
        >
          {title}
        </h2>
        {meta && (
          <div
            className="text-[12px] font-mono mt-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            {meta}
          </div>
        )}
      </div>
      {description && (
        <p
          className="text-[14px] leading-relaxed max-w-md"
          style={{ color: "var(--color-text-muted)" }}
        >
          {description}
        </p>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div
        className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums font-display"
        style={{ color: "var(--color-fg)" }}
      >
        {n}
      </div>
      <div
        className="text-[11px] mt-2 leading-snug"
        style={{ color: "var(--color-text-muted)" }}
      >
        {label}
      </div>
    </div>
  );
}

function WordmarkBadge() {
  return (
    <div
      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
      style={{ background: "var(--color-accent-strong)" }}
    >
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        aria-hidden
      >
        <path d="M4 12 L10 6 L10 18 Z" fill="white" />
        <path d="M14 6 L20 12 L14 18" />
      </svg>
    </div>
  );
}

function PreviewHero() {
  return (
    <header
      id="top"
      className="px-6 md:px-12 pt-16 pb-20 relative overflow-hidden"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <div className="absolute inset-x-0 top-0 h-[420px] opacity-60 pointer-events-none">
        <MeshGrain brandHue={BRAND_HUE} className="w-full h-full" />
      </div>
      <div
        className="absolute inset-x-0 top-0 h-[420px] pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, transparent 60%, var(--color-bg) 100%)",
        }}
      />
      <div className="relative max-w-6xl">
        <div className="flex items-center gap-3 mb-10 flex-wrap">
          <WordmarkBadge />
          <div
            className="text-[13px] font-semibold tracking-tight font-display"
            style={{ color: "var(--color-fg)" }}
          >
            OpenLen
          </div>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--color-text-dim)" }}
          >
            ·
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--color-text-muted)" }}
          >
            design foundations
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--color-text-dim)" }}
          >
            ·
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--color-text-muted)" }}
          >
            v0.1.0
          </span>
          <span
            className="ml-auto text-[11px] font-mono"
            style={{ color: "var(--color-text-dim)" }}
          >
            openlen.com / foundations
          </span>
        </div>
        <div
          className="text-[11px] font-mono uppercase tracking-[0.18em] mb-4"
          style={{ color: "var(--color-accent-strong)" }}
        >
          AGPL v3 · OKLCH · server-renderable
        </div>
        <h1
          className="text-[56px] sm:text-[72px] md:text-[88px] leading-[0.95] tracking-[-0.04em] font-semibold max-w-4xl font-display text-balance"
          style={{ color: "var(--color-fg)" }}
        >
          The visual primitives
          <br />
          behind every OpenLen
          <br />
          landing page.
        </h1>
        <p
          className="text-[17px] leading-relaxed mt-8 max-w-xl"
          style={{ color: "var(--color-text-muted)" }}
        >
          Eight backgrounds, twenty palettes, five decorations. Each one
          parameterised by a single
          <code
            className="mx-1 px-1.5 py-0.5 rounded font-mono text-[14px]"
            style={{
              background: "var(--color-surface)",
              color: "var(--color-fg)",
            }}
          >
            brandHue
          </code>
          and generated by pure math. No hex codes were harmed in the making
          of this system.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mt-16 max-w-3xl">
          <Stat n="8" label="Background components" />
          <Stat n="20" label="Palettes · 10 hues × 2 modes" />
          <Stat n="5" label="SVG decorations" />
          <Stat n="10" label="Tokens per palette" />
        </div>
      </div>
    </header>
  );
}

function TypographyNotes() {
  return (
    <section
      className="border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="max-w-[1180px] mx-auto px-6 md:px-10 py-20">
        <div
          className="text-[11.5px] uppercase tracking-[0.2em] mb-3 font-mono"
          style={{ color: "var(--color-text-muted)" }}
        >
          First-pass notes
        </div>
        <h3
          className="font-semibold font-display text-[32px] leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ color: "var(--color-fg)", maxWidth: "30ch" }}
        >
          What to flag before we commit.
        </h3>
        <ul
          className="mt-6 space-y-3 text-[15.5px] leading-[1.6]"
          style={{ color: "var(--color-fg)", maxWidth: "72ch" }}
        >
          <li>
            <b>JetBrains Mono at 52px H1</b> — readable, but the mono glyph
            rhythm fights long display lines. If headlines push past 8 words,
            I&apos;d cap H1 at ~44px or break to two lines. The
            smaller-than-others H1 is intentional.
          </li>
          <li>
            <b>Crimson Pro</b> reads <i>print-essay</i> more than{" "}
            <i>SaaS landing</i>. Best for OpenLen <i>blog</i> / launch{" "}
            <i>essay</i>, not the marketing surface. Recommend demoting to a
            &quot;Long-form&quot; preset.
          </li>
          <li>
            <b>Söhne Warm uses Inter as a substitute.</b> Inter&apos;s larger
            x-height makes the 1.333 scale feel slightly more boisterous than
            Söhne would. If a Söhne license is available, swap in — the
            rule-break (italic aside) carries either way.
          </li>
          <li>
            <b>Fraunces opsz=144</b> applied only to display — body Inter
            handles the small-size reading. Italic-H2 rule-break feels
            strongest when surrounded by upright H1/H3.
          </li>
        </ul>
      </div>
    </section>
  );
}

const heroSlots = {
  eyebrow: "New in v3",
  headline: "Beautiful landing pages, your code, $19 a month.",
  subhead:
    "OpenLen turns a 50-word brief into a self-contained HTML page that you own. No platform lock-in.",
  ctaPrimary: { label: "Generate yours", href: "#" },
  ctaSecondary: { label: "See examples", href: "#" },
  socialProof: "1,400+ landings shipped this week",
};

const stackSlots = {
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

const splitSlots = {
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

const beforeAfterSlots = {
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

const featureSlots = {
  eyebrow: "Built for the long tail",
  title: "Boring infrastructure for un-boring pages.",
  sub: "OpenLen is unapologetically opinionated about the parts that don't need creativity.",
  items: [
    {
      title: "Type-safe slots",
      body: "Every primitive declares its content shape. No prop drilling, no untyped string soup.",
      media: { kind: "icon" as const, name: "shield" },
    },
    {
      title: "Brand from one hue",
      body:
        "Set a single OKLCH hue and the whole page calibrates. Light, dark, and high-contrast for free.",
      media: { kind: "icon" as const, name: "spark" },
      accent: true,
    },
    {
      title: "Ships static HTML",
      body: "No runtime JavaScript required. Drop the folder on any host. Lighthouse 100 by default.",
      media: { kind: "icon" as const, name: "bolt" },
    },
  ],
};

const testimonialSlots = {
  eyebrow: "Receipts",
  title: "Used by people who write the docs you read.",
  sub: "A small but loud sample of OpenLen's first-month adopters.",
  items: [
    {
      title: "Mira Adeyemi",
      media: { kind: "text" as const, value: "Engineering Lead · Lattice" },
      body:
        "We replaced four marketing-page Notion docs with OpenLen. Page builds are now a PR review instead of a meeting.",
    },
    {
      title: "Jonas Petrov",
      media: { kind: "text" as const, value: "Indie hacker · zsh.tools" },
      body:
        "Shipped my launch page Saturday morning. Built three more by Sunday lunch. The brief-to-page loop is unreasonably fast.",
    },
    {
      title: "Sarah Quan",
      media: { kind: "text" as const, value: "Founder · Daybook" },
      body:
        "The output is the kind of clean HTML I'd hand to a junior dev. No vendor div soup. Read like a designer wrote it.",
      accent: true,
    },
    {
      title: "Etan Roux",
      media: { kind: "text" as const, value: "Staff Designer · Plural" },
      body: "It's the first AI tool I've used that respects type rhythm. Restraint over decoration — finally.",
    },
    {
      title: "Wei-Lin Chen",
      media: { kind: "text" as const, value: "Solo founder · Boxlet" },
      body: "Replaced a $400/mo agency retainer with $19. The agency was nicer at lunch but slower at everything else.",
    },
    {
      title: "Ola Brandt",
      media: { kind: "text" as const, value: "VP Marketing · Filed" },
      body: "Self-hosting was the dealbreaker for legal. OpenLen on our VPS shipped in an afternoon.",
    },
  ],
};

const statsSlots = {
  eyebrow: "By the numbers",
  title: "What 'shipped' looks like at month four.",
  items: [
    {
      title: "Pages generated",
      media: { kind: "text" as const, value: "182,000" },
      body: "Since the public beta opened in February.",
    },
    {
      title: "Avg. time to ship",
      media: { kind: "text" as const, value: "11 min" },
      body: "Brief submitted to live URL, p50 across paying users.",
    },
    {
      title: "Lighthouse perf",
      media: { kind: "text" as const, value: "98 / 100" },
      body: "Median across the last 1,000 generated pages.",
    },
    {
      title: "Self-hosted",
      media: { kind: "text" as const, value: "3,400+" },
      body: "Independent OpenLen instances pinging the registry.",
    },
  ],
};

const logoSlots = {
  title: "Trusted by teams building quietly",
  items: [
    "Lattice", "Plural", "Filed", "Daybook",
    "Boxlet", "zsh.tools", "Verge·", "Crowdcast",
  ].map(x => ({ title: x, media: { kind: "text" as const, value: x } })),
};

const pricingSlots = {
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
      media: { kind: "text" as const, value: "AGPL" },
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
      media: { kind: "text" as const, value: "Popular" },
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
      media: { kind: "text" as const, value: "Agencies" },
    },
  ],
};

const ctaCenteredSlots = {
  eyebrow: "Try it",
  headline: "Write the brief. Let OpenLen ship the page.",
  sub: "Free to self-host. $19 a month for the hosted runtime. Cancel any time.",
  ctaPrimary: { label: "Generate a page", href: "#" },
  ctaSecondary: { label: "Read the docs", href: "#" },
  footnote: "No credit card required for the 14-day trial.",
};

const ctaCardSlots = {
  eyebrow: "Weekly digest",
  headline: "Five briefs, five pages, every Friday.",
  sub: "We turn five reader-submitted briefs into pages each week and ship the breakdown to your inbox.",
  ctaPrimary: { label: "Subscribe", href: "#" },
  footnote: "12,000 designers and indie devs. Unsubscribe in one click.",
};

const ctaGradientSlots = {
  eyebrow: "Ready when you are",
  headline: "Ship the page you've been meaning to ship.",
  sub: "Fourteen days free, all 5 primitives, every export format. The only thing you have to bring is the brief.",
  ctaPrimary: { label: "Generate yours", href: "#" },
  ctaSecondary: { label: "See the spec", href: "#" },
  footnote: "AGPL · brandHue 12 · v3.2.0",
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant table
// ─────────────────────────────────────────────────────────────────────────────

interface VariantEntry {
  primitive: string;
  variant: string;
  node: ReactNode;
}

const VARIANT_TABLE: VariantEntry[] = [
  { primitive: "Hero", variant: "centered", node: <Hero id="hero1" variant="centered" slots={heroSlots} /> },
  { primitive: "Hero", variant: "split", node: <Hero id="hero2" variant="split" slots={heroSlots} /> },
  { primitive: "Hero", variant: "asymmetric", node: <Hero id="hero3" variant="asymmetric" slots={heroSlots} /> },

  { primitive: "Stack", variant: "vertical-cards", node: <Stack id="stack1" variant="vertical-cards" slots={stackSlots} /> },
  { primitive: "Stack", variant: "alternating-rows", node: <Stack id="stack2" variant="alternating-rows" slots={stackSlots} /> },
  { primitive: "Stack", variant: "icon-grid-3col", node: <Stack id="stack3" variant="icon-grid-3col" slots={{ ...stackSlots, items: stackSlots.items.slice(0, 3) }} /> },

  { primitive: "Split", variant: "side-by-side", node: <Split id="split1" variant="side-by-side" slots={splitSlots} /> },
  { primitive: "Split", variant: "comparison-table", node: <Split id="split2" variant="comparison-table" slots={{ ...splitSlots, title: "OpenLen vs. Lovable, feature by feature.", sub: "Same job, two opposite philosophies." }} /> },
  { primitive: "Split", variant: "before-after", node: <Split id="split3" variant="before-after" slots={beforeAfterSlots} /> },

  { primitive: "Grid", variant: "logo-bar", node: <Grid id="grid1" variant="logo-bar" slots={logoSlots} /> },
  { primitive: "Grid", variant: "feature-3col", node: <Grid id="grid2" variant="feature-3col" slots={featureSlots} /> },
  { primitive: "Grid", variant: "testimonial-masonry", node: <Grid id="grid3" variant="testimonial-masonry" slots={testimonialSlots} /> },
  { primitive: "Grid", variant: "stats-4-grid", node: <Grid id="grid4" variant="stats-4-grid" slots={statsSlots} /> },
  { primitive: "Grid", variant: "pricing-3tier", node: <Grid id="grid5" variant="pricing-3tier" slots={pricingSlots} /> },

  { primitive: "CTA", variant: "centered-banner", node: <CTA id="cta1" variant="centered-banner" slots={ctaCenteredSlots} /> },
  { primitive: "CTA", variant: "card-form", node: <CTA id="cta2" variant="card-form" slots={ctaCardSlots} /> },
  { primitive: "CTA", variant: "gradient-banner", node: <CTA id="cta3" variant="gradient-banner" slots={ctaGradientSlots} /> },
];

const anchorFor = (p: string, v: string) => `${p.toLowerCase()}-${v}`;

// ─────────────────────────────────────────────────────────────────────────────
// Foundations gallery — backgrounds + decorations + palettes
// ─────────────────────────────────────────────────────────────────────────────

function BackgroundsGallery({ items }: { items: BackgroundSpec[] }) {
  return (
    <section
      className="px-6 md:px-12 py-20 border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="max-w-[80rem] mx-auto">
        <SectionHeader
          eyebrow="Part 01"
          title="Backgrounds"
          meta="8 components · brandHue parameterised · <5KB combined"
          description="Each background is self-contained and renders identically on the server. Pass any hue 0–360 and the math takes care of the rest."
        />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
          {items.map(({ name, Component, blurb }, i) => (
            <figure key={name} className="flex flex-col gap-3">
              <Component
                brandHue={BRAND_HUE}
                className="w-full aspect-[16/9] rounded-lg ring-1 ring-black/[0.06]"
              />
              <figcaption className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: "var(--color-text-dim)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] font-semibold tracking-tight font-display" style={{ color: "var(--color-fg)" }}>
                    {name}
                  </span>
                </div>
                <div className="text-[11px] leading-snug" style={{ color: "var(--color-text-muted)" }}>
                  {blurb}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function DecorationsGallery({ items }: { items: DecorationSpec[] }) {
  return (
    <section
      className="px-6 md:px-12 py-20 border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="max-w-[80rem] mx-auto">
        <SectionHeader
          eyebrow="Part 03"
          title="Decorations"
          meta="5 SVG overlays · drop-in · onLight ready"
          description="Self-contained SVG you stack on top of any solid background. Three intensity steps per overlay — restraint, balance, or bold."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {items.map(({ name, Component, blurb, knob }, i) => (
            <div key={name} className="flex flex-col gap-3">
              <div
                className="relative overflow-hidden w-full aspect-[16/9] rounded-lg ring-1 ring-black/[0.08]"
                style={{ background: `oklch(13% 0.012 ${BRAND_HUE})` }}
              >
                <Component brandHue={BRAND_HUE} intensity="balanced" />
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: "var(--color-text-dim)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] font-semibold tracking-tight font-display" style={{ color: "var(--color-fg)" }}>
                    {name}
                  </span>
                </div>
                <div className="text-[11px] leading-snug" style={{ color: "var(--color-text-muted)" }}>
                  {blurb}
                </div>
                <div className="text-[10px] font-mono mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                  {knob}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["minimal", "balanced", "bold"] as const).map(level => (
                  <div key={level} className="flex flex-col gap-1">
                    <div
                      className="relative overflow-hidden w-full aspect-[16/9] rounded ring-1 ring-black/[0.08]"
                      style={{ background: `oklch(13% 0.012 ${BRAND_HUE})` }}
                    >
                      <Component brandHue={BRAND_HUE} intensity={level} />
                    </div>
                    <div
                      className="text-[9px] font-mono text-center uppercase tracking-wide"
                      style={{ color: "var(--color-text-dim)" }}
                    >
                      {level.slice(0, 3)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PaletteCard({ spec }: { spec: PaletteSpec }) {
  const p = generatePalette(spec.brandHue, spec.mode);
  const v = validatePalette(p);
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{
        background: "var(--color-bg)",
        borderColor: v.ok ? "var(--color-border)" : "oklch(58% 0.22 25)",
        boxShadow: v.ok ? "0 1px 0 oklch(0% 0 0 / 0.02)" : "0 0 0 2px oklch(58% 0.22 25 / 0.12)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tracking-tight font-display truncate" style={{ color: "var(--color-fg)" }}>
            {spec.name}
          </div>
          <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--color-text-muted)" }}>
            {spec.personality}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded tabular-nums"
            style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}
          >
            h{spec.brandHue}
          </span>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: spec.mode === "dark" ? "oklch(15% 0.01 220)" : "oklch(94% 0.005 220)",
              color: spec.mode === "dark" ? "oklch(95% 0.005 220)" : "oklch(25% 0.01 220)",
            }}
          >
            {spec.mode}
          </span>
        </div>
      </div>
      <div className="rounded-md overflow-hidden border p-3" style={{ background: p.bg, borderColor: p.border }}>
        <div className="text-[10px] font-mono mb-1" style={{ color: p.fgDim }}>
          openlen.com<span style={{ color: p.fgMuted }}> / pricing</span>
        </div>
        <div
          className="text-[14px] font-semibold leading-tight tracking-tight font-display"
          style={{ color: p.fg }}
        >
          Ship a landing page<br />in one prompt.
        </div>
        <div className="flex gap-1.5 mt-2 items-center">
          <button
            className="text-[10px] font-medium px-2 py-1 rounded font-display"
            style={{ background: p.accent, color: p.accentFg }}
          >
            Get started
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {(["bg", "fg", "surface", "border", "accent", "accentFg"] as const).map(t => (
          <div key={t} className="flex items-center gap-2 min-w-0">
            <div
              className="w-5 h-5 rounded shrink-0 border"
              style={{ background: p[t], borderColor: "oklch(0% 0 0 / 0.08)" }}
            />
            <div className="text-[10px] font-medium truncate font-display" style={{ color: "var(--color-fg)" }}>
              {t}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 flex items-center justify-between text-[9px] font-mono" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex gap-2">
          {v.checks.map(c => (
            <div key={c.name} className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: c.ratio >= c.min ? "oklch(65% 0.18 145)" : "oklch(58% 0.22 25)" }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>{c.name}</span>
              <span style={{ color: "var(--color-fg)" }} className="tabular-nums">
                {c.ratio.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div style={{ color: v.ok ? "var(--color-text-dim)" : "oklch(58% 0.22 25)" }}>
          {v.ok ? "AA ✓" : "AA ✗"}
        </div>
      </div>
    </div>
  );
}

function TypographyCard({ spec, idx }: { spec: TypographySpec; idx: number }) {
  const displayName = spec.displayFamily.split(",")[0].replace(/['"]/g, "");
  const bodyName = spec.bodyFamily.split(",")[0].replace(/['"]/g, "");
  return (
    <section
      className={spec.cls}
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 pt-16 pb-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[13px] font-semibold tabular-nums"
              style={{ background: "var(--color-surface)", color: "var(--color-accent-strong)" }}
            >
              {String(idx + 1).padStart(2, "0")}
            </span>
            <span
              className="text-[13px] uppercase tracking-[0.18em]"
              style={{ color: "var(--color-text-muted)" }}
            >
              System
            </span>
            <span className="text-[20px] font-semibold" style={{ letterSpacing: "-0.02em", color: "var(--color-fg)" }}>
              {spec.name}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12.5px] font-mono" style={{ color: "var(--color-text-muted)" }}>
            <span
              className="rounded-md px-2 py-1"
              style={{ background: "var(--color-surface)", color: "var(--color-accent-strong)" }}
            >
              {displayName}
            </span>
            <span style={{ opacity: 0.5 }}>/</span>
            <span
              className="rounded-md px-2 py-1"
              style={{ background: "var(--color-surface)", color: "var(--color-accent-strong)" }}
            >
              {bodyName}
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span
              className="rounded-md px-2 py-1"
              style={{ background: "var(--color-surface)", color: "var(--color-accent-strong)" }}
            >
              {spec.scale}× scale
            </span>
          </div>
        </div>
        <p className="mt-4 text-[14px]" style={{ color: "var(--color-text-muted)", maxWidth: "72ch" }}>
          <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>Personality.</span> {spec.personality}
        </p>
      </div>

      {/* Sample */}
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 pt-10 pb-14">
        <div className="sample">
          <div className="s-eyebrow" style={{ color: "var(--color-accent-strong)" }}>
            Now in private beta
          </div>
          <h1 className="s-h1 mt-5" style={{ textWrap: "balance", color: "var(--color-fg)" }}>
            Ship beautiful landing pages, before lunch.
          </h1>
          <p
            className="s-sub mt-6"
            style={{ maxWidth: "54ch", textWrap: "pretty", color: "var(--color-text-muted)" }}
          >
            OpenLen turns a 50-word brief into a self-contained HTML page that lives at your own subdomain.
          </p>
          <div className="mt-8 flex items-center" style={{ gap: 12 }}>
            <a
              className="s-btn inline-flex items-center gap-2"
              href="#"
              style={{
                background: "var(--color-accent)",
                color: "var(--color-accent-fg)",
                padding: "12px 18px",
                borderRadius: 999,
              }}
            >
              Try it free
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </a>
            <a
              className="s-btn"
              href="#"
              style={{ color: "var(--color-fg)", padding: "12px 14px", borderRadius: 999 }}
            >
              View an example →
            </a>
          </div>
          <hr className="mt-12" style={{ borderTopWidth: 1, borderColor: "var(--color-border)" }} />
          <h2 className="s-h2 mt-10" style={{ color: "var(--color-fg)" }}>
            How it works
          </h2>
          <p
            className="s-body mt-5"
            style={{ maxWidth: "62ch", textWrap: "pretty", color: "var(--color-fg)" }}
          >
            Every output passes six quality gates before it ships. No bug loops, no $50/month minimums.
          </p>
          <p className="s-aside mt-3" style={{ maxWidth: "60ch", color: "var(--color-text-muted)" }}>
            — A brief is a contract with the page. We never invent sections you didn&apos;t ask for.
          </p>
        </div>
      </div>

      {/* Metadata strip */}
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 pb-20">
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12.5px] font-mono"
          style={{ color: "var(--color-text-muted)" }}
        >
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--color-surface)" }}
          >
            <div
              className="uppercase tracking-[0.14em] text-[10.5px] mb-2"
              style={{ color: "var(--color-accent-strong)" }}
            >
              Tracking
            </div>
            <div>display&nbsp;&nbsp;{spec.displayTracking}</div>
            <div>body&nbsp;&nbsp;&nbsp;&nbsp;{spec.bodyTracking || "0em"}</div>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--color-surface)" }}
          >
            <div
              className="uppercase tracking-[0.14em] text-[10.5px] mb-2"
              style={{ color: "var(--color-accent-strong)" }}
            >
              Leading + sizes
            </div>
            <div>leading&nbsp;&nbsp;{spec.leading}</div>
            <div>
              h1&nbsp;{spec.sizes["5xl"]}px&nbsp;·&nbsp;body&nbsp;{spec.sizes.base}px
            </div>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--color-accent-soft)" }}
          >
            <div
              className="uppercase tracking-[0.14em] text-[10.5px] mb-2"
              style={{ color: "var(--color-accent-strong)" }}
            >
              Rule-break
            </div>
            <div style={{ color: "var(--color-fg)" }}>{spec.ruleBreak}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TypographyGallery() {
  // Inject the per-system stylesheet inline so .sys-* classes resolve.
  const css = buildTypographyStylesheet() +
    `
.sample { font-family: var(--body-family); font-weight: var(--body-weight); letter-spacing: var(--body-tracking); line-height: var(--leading); }
.sample .s-eyebrow { font-size: var(--text-xs); letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.sample .s-h1 { font-family: var(--display-family); font-weight: var(--display-weight); letter-spacing: var(--display-tracking); font-size: var(--text-5xl); line-height: 1.02; font-optical-sizing: auto; font-variation-settings: "opsz" 144; }
.sample .s-sub { font-family: var(--body-family); font-size: var(--text-lg); line-height: 1.45; font-weight: var(--body-weight); }
.sample .s-h2 { font-family: var(--display-family); font-weight: var(--display-weight); letter-spacing: var(--display-tracking); font-size: var(--text-2xl); line-height: 1.1; font-optical-sizing: auto; }
.sample .s-body { font-size: var(--text-base); }
.sample .s-aside { font-size: var(--text-base); }
.sample .s-btn { font-family: var(--body-family); font-size: var(--text-sm); font-weight: 600; letter-spacing: 0.02em; }
`;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <section
        className="border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="max-w-[80rem] mx-auto px-6 md:px-12 pt-20 pb-4">
          <SectionHeader
            eyebrow="Part 04"
            title="Typography Systems"
            meta="6 systems · one intentional rule-break each · same sample copy"
            description="Each system applies a complete type stack — families, weights, tracking, leading, modular scale — to the same six lines of marketing copy."
          />
        </div>
        {TYPOGRAPHY_PRESETS.map((spec, i) => (
          <TypographyCard key={spec.id} spec={spec} idx={i} />
        ))}
      </section>
    </>
  );
}

function PalettesGallery() {
  return (
    <section
      className="px-6 md:px-12 py-20 border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="max-w-[80rem] mx-auto">
        <SectionHeader
          eyebrow="Part 02"
          title="Palettes"
          meta="20 systems · OKLCH · WCAG AA validated"
          description="Every palette is generated by pure math from a single brandHue input. Ten tokens, two modes, ten hues — composable, predictable, server-renderable."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PALETTE_PRESETS.map(spec => (
            <PaletteCard key={spec.id} spec={spec} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant section wrapper (TOC + frame)
// ─────────────────────────────────────────────────────────────────────────────

function VariantSection({
  anchor,
  primitive,
  variant,
  children,
}: {
  anchor: string;
  primitive: string;
  variant: string;
  children: ReactNode;
}) {
  return (
    <section id={anchor} className="scroll-mt-20">
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 mb-5">
        <div className="flex items-baseline justify-between gap-6 pt-16">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.18em]" style={{ color: "var(--color-text-dim)" }}>
              {primitive}
            </span>
            <span className="font-mono text-[12px]" style={{ color: "var(--color-text-dim)" }}>·</span>
            <h3 className="font-display text-[28px] tracking-[-0.015em]" style={{ color: "var(--color-fg)" }}>
              {variant}
            </h3>
          </div>
          <a href="#top" className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-text-dim)" }}>
            ↑ top
          </a>
        </div>
        <div className="mt-3 h-px" style={{ background: "var(--color-border)" }} />
      </div>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10">
        <div className="variant-frame">{children}</div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export const metadata = {
  title: "OpenLen V3 · Design System Preview",
};

export default function PreviewV3Page() {
  return (
    <>
      {/* Next.js 15 hoists these <link> tags into <head> automatically. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&family=Inter+Tight:ital,wght@0,400..700;1,400..700&family=Inter:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:ital,wght@0,400..600;1,400..600&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Crimson+Pro:ital,wght@0,400..700;1,400..700&display=swap"
      />
      <div
        style={{
          background: "var(--color-bg)",
          color: "var(--color-fg)",
          fontFamily: "var(--font-body)",
        }}
      >
        <PreviewHero />

        <BackgroundsGallery items={BACKGROUND_PRESETS} />
        <PalettesGallery />
        <DecorationsGallery items={DECORATION_PRESETS} />
        <TypographyGallery />
        <TypographyNotes />

        <section
          id="variants"
          className="px-6 md:px-12 py-20 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="max-w-[80rem] mx-auto">
            <SectionHeader
              eyebrow="Part 05"
              title="Layout Primitives"
              meta="17 variants · 5 primitives · brandHue 12"
              description="Every layout OpenLen can compose, rendered with the same demo content, against the same OKLCH token system."
            />
          </div>
          {VARIANT_TABLE.map(({ primitive, variant, node }) => (
            <VariantSection
              key={`${primitive}-${variant}`}
              anchor={anchorFor(primitive, variant)}
              primitive={primitive}
              variant={variant}
            >
              {node}
            </VariantSection>
          ))}
        </section>

        <footer
          className="px-6 md:px-12 py-12 border-t flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
          }}
        >
          <div
            className="flex items-center gap-3 text-[11px] font-mono flex-wrap"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span>OpenLen design foundations</span>
            <span style={{ color: "var(--color-text-dim)" }}>·</span>
            <span>AGPL v3</span>
            <span style={{ color: "var(--color-text-dim)" }}>·</span>
            <span>v0.1.0</span>
          </div>
          <div
            className="text-[11px] font-mono italic"
            style={{ color: "var(--color-text-dim)" }}
          >
            &ldquo;restraint over decoration · OKLCH math over guesswork&rdquo;
          </div>
        </footer>
      </div>
    </>
  );
}
