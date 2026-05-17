// Mini wireframe SVGs for the 17 layout primitive variants.
// Each renders the STRUCTURE of a section (where text vs media vs cards live)
// in a compact 56×40 viewport. Used by the composition editor inline picker
// + (eventually) the templates gallery preview cards.
//
// Visual style: 1.5px strokes, no fill, current color via `--accent` for
// "active region" and `--text-faint` for the rest. Reads identically light/dark.

"use client";

import type { ReactNode } from "react";

interface WireframeProps {
  size?: number;
  className?: string;
}

// Shared frame: 56×40 box with 1px outer hairline so every wireframe has
// the same physical footprint inside its thumbnail card.
function Frame({ children, size = 56, className = "" }: WireframeProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 56 40"
      width={size}
      height={(size * 40) / 56}
      className={className}
      aria-hidden
    >
      <rect
        width="56"
        height="40"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
      />
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {children}
      </g>
    </svg>
  );
}

// Accent stroke (using --accent via inline style) for the "highlight" element
// of each layout — the hero text, the featured pricing tier, etc.
const ACCENT = "var(--accent, oklch(58% 0.22 12))";

// ─── Hero × 3 ────────────────────────────────────────────────────────────────

function HeroCentered({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="18" y1="14" x2="38" y2="14" />
      <line x1="14" y1="20" x2="42" y2="20" stroke={ACCENT} strokeWidth="1.8" />
      <line x1="20" y1="26" x2="36" y2="26" strokeOpacity="0.5" />
      <rect x="22" y="30" width="6" height="4" rx="1" stroke={ACCENT} strokeOpacity="1" />
      <rect x="30" y="30" width="6" height="4" rx="1" strokeOpacity="0.4" />
    </Frame>
  );
}

function HeroSplit({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="6" y1="13" x2="20" y2="13" />
      <line x1="6" y1="17" x2="26" y2="17" stroke={ACCENT} strokeWidth="1.8" />
      <line x1="6" y1="23" x2="22" y2="23" strokeOpacity="0.5" />
      <rect x="6" y="28" width="6" height="4" rx="1" stroke={ACCENT} strokeOpacity="1" />
      <rect x="32" y="6" width="18" height="28" rx="2" strokeOpacity="0.45" />
    </Frame>
  );
}

function HeroAsymmetric({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="4" y1="11" x2="18" y2="11" />
      <line x1="3" y1="17" x2="32" y2="17" stroke={ACCENT} strokeWidth="2" />
      <line x1="6" y1="23" x2="26" y2="23" strokeOpacity="0.5" />
      <rect x="6" y="27" width="6" height="4" rx="1" stroke={ACCENT} strokeOpacity="1" />
      <rect
        x="35"
        y="9"
        width="16"
        height="22"
        rx="2"
        strokeOpacity="0.5"
        transform="rotate(-2 43 20)"
      />
    </Frame>
  );
}

// ─── Stack × 3 ───────────────────────────────────────────────────────────────

function StackVerticalCards({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <rect x="12" y="6" width="32" height="8" rx="1.5" strokeOpacity="0.5" />
      <rect x="12" y="16" width="32" height="8" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <rect x="12" y="26" width="32" height="8" rx="1.5" strokeOpacity="0.5" />
    </Frame>
  );
}

function StackAlternatingRows({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="6" y1="10" x2="22" y2="10" />
      <line x1="6" y1="14" x2="18" y2="14" strokeOpacity="0.5" />
      <line x1="34" y1="22" x2="50" y2="22" />
      <line x1="38" y1="26" x2="50" y2="26" strokeOpacity="0.5" />
      <line x1="6" y1="34" x2="22" y2="34" strokeOpacity="0.7" />
    </Frame>
  );
}

function StackIconGrid({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="6" y1="8" x2="22" y2="8" strokeOpacity="0.6" />
      <rect x="7" y="14" width="14" height="20" rx="1.5" strokeOpacity="0.5" />
      <rect x="23" y="14" width="14" height="20" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <rect x="39" y="14" width="11" height="20" rx="1.5" strokeOpacity="0.5" />
    </Frame>
  );
}

// ─── Split × 3 ───────────────────────────────────────────────────────────────

function SplitSideBySide({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="28" y1="6" x2="28" y2="34" strokeOpacity="0.3" />
      <line x1="6" y1="12" x2="22" y2="12" />
      <line x1="6" y1="18" x2="22" y2="18" strokeOpacity="0.5" />
      <line x1="6" y1="22" x2="20" y2="22" strokeOpacity="0.5" />
      <line x1="32" y1="12" x2="48" y2="12" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="32" y1="18" x2="48" y2="18" strokeOpacity="0.5" />
      <line x1="32" y1="22" x2="46" y2="22" strokeOpacity="0.5" />
    </Frame>
  );
}

function SplitComparisonTable({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="6" y1="14" x2="50" y2="14" strokeOpacity="0.5" />
      <line x1="6" y1="22" x2="50" y2="22" strokeOpacity="0.4" />
      <line x1="6" y1="30" x2="50" y2="30" strokeOpacity="0.4" />
      <line x1="28" y1="8" x2="28" y2="34" strokeOpacity="0.3" />
      <line x1="40" y1="8" x2="40" y2="34" strokeOpacity="0.3" />
      <line x1="33" y1="18" x2="35" y2="18" strokeOpacity="0.4" />
      <line x1="33" y1="26" x2="35" y2="26" strokeOpacity="0.4" />
      <path d="M44 17l2 2 4-4" stroke={ACCENT} strokeWidth="1.6" />
      <path d="M44 25l2 2 4-4" stroke={ACCENT} strokeWidth="1.6" />
    </Frame>
  );
}

function SplitBeforeAfter({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <rect x="6" y="6" width="20" height="28" rx="1.5" strokeOpacity="0.5" />
      <line x1="9" y1="12" x2="18" y2="12" strokeOpacity="0.7" />
      <line x1="9" y1="16" x2="22" y2="16" strokeOpacity="0.5" />
      <line x1="9" y1="20" x2="20" y2="20" strokeOpacity="0.4" />
      <rect x="30" y="6" width="20" height="28" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="33" y1="12" x2="42" y2="12" />
      <line x1="33" y1="16" x2="46" y2="16" />
      <line x1="33" y1="20" x2="44" y2="20" strokeOpacity="0.7" />
      <circle cx="28" cy="20" r="2" fill={ACCENT} stroke="none" />
    </Frame>
  );
}

// ─── Grid × 5 ────────────────────────────────────────────────────────────────

function GridLogoBar({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="20" y1="9" x2="36" y2="9" strokeOpacity="0.5" />
      <g strokeOpacity="0.55">
        <rect x="6" y="16" width="8" height="6" rx="1" />
        <rect x="16" y="16" width="8" height="6" rx="1" />
        <rect x="26" y="16" width="8" height="6" rx="1" />
        <rect x="36" y="16" width="8" height="6" rx="1" />
        <rect x="46" y="16" width="4" height="6" rx="1" />
        <rect x="11" y="26" width="8" height="6" rx="1" />
        <rect x="21" y="26" width="8" height="6" rx="1" />
        <rect x="31" y="26" width="8" height="6" rx="1" />
        <rect x="41" y="26" width="8" height="6" rx="1" />
      </g>
    </Frame>
  );
}

function GridFeature3({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="6" y1="8" x2="24" y2="8" strokeOpacity="0.5" />
      <rect x="6" y="14" width="13" height="20" rx="1.5" strokeOpacity="0.5" />
      <circle cx="9.5" cy="18" r="1.5" strokeOpacity="0.55" />
      <rect x="21" y="14" width="14" height="20" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <circle cx="24.5" cy="18" r="1.5" fill={ACCENT} stroke="none" />
      <rect x="37" y="14" width="13" height="20" rx="1.5" strokeOpacity="0.5" />
      <circle cx="40.5" cy="18" r="1.5" strokeOpacity="0.55" />
    </Frame>
  );
}

function GridTestimonialMasonry({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <rect x="5" y="6" width="14" height="14" rx="1.5" strokeOpacity="0.5" />
      <rect x="21" y="6" width="14" height="18" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <rect x="37" y="6" width="14" height="12" rx="1.5" strokeOpacity="0.5" />
      <rect x="5" y="22" width="14" height="14" rx="1.5" strokeOpacity="0.5" />
      <rect x="21" y="26" width="14" height="10" rx="1.5" strokeOpacity="0.5" />
      <rect x="37" y="20" width="14" height="16" rx="1.5" strokeOpacity="0.5" />
    </Frame>
  );
}

function GridStats4({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="6" y1="8" x2="22" y2="8" strokeOpacity="0.5" />
      <g strokeOpacity="0.5">
        <line x1="17" y1="14" x2="17" y2="32" />
        <line x1="29" y1="14" x2="29" y2="32" />
        <line x1="41" y1="14" x2="41" y2="32" />
      </g>
      <text x="11" y="25" fontSize="6.5" fontWeight="700" fill={ACCENT} stroke="none" textAnchor="middle">
        42
      </text>
      <line x1="6" y1="28" x2="14" y2="28" strokeOpacity="0.4" />
      <text x="23" y="25" fontSize="6.5" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
        $13
      </text>
      <line x1="19" y1="28" x2="27" y2="28" strokeOpacity="0.4" />
      <text x="35" y="25" fontSize="6.5" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
        6/6
      </text>
      <text x="46" y="25" fontSize="5" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
        1.4K
      </text>
    </Frame>
  );
}

function GridPricing3({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="18" y1="6" x2="38" y2="6" strokeOpacity="0.5" />
      <rect x="6" y="11" width="14" height="22" rx="1.5" strokeOpacity="0.55" />
      <line x1="9" y1="16" x2="13" y2="16" strokeOpacity="0.6" />
      <line x1="9" y1="20" x2="17" y2="20" strokeOpacity="0.4" />
      <rect x="22" y="9" width="14" height="26" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="25" y1="14" x2="29" y2="14" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="25" y1="18" x2="33" y2="18" strokeOpacity="0.7" />
      <rect x="25" y="27" width="8" height="4" rx="1" fill={ACCENT} stroke="none" />
      <rect x="38" y="11" width="14" height="22" rx="1.5" strokeOpacity="0.55" />
      <line x1="41" y1="16" x2="45" y2="16" strokeOpacity="0.6" />
      <line x1="41" y1="20" x2="49" y2="20" strokeOpacity="0.4" />
    </Frame>
  );
}

// ─── CTA × 3 ─────────────────────────────────────────────────────────────────

function CTACenteredBanner({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="14" y1="14" x2="42" y2="14" />
      <line x1="18" y1="20" x2="38" y2="20" strokeOpacity="0.55" />
      <rect x="20" y="25" width="7" height="5" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <rect x="29" y="25" width="7" height="5" rx="1.5" strokeOpacity="0.5" />
    </Frame>
  );
}

function CTACardForm({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <rect x="12" y="9" width="32" height="22" rx="2" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="16" y1="14" x2="32" y2="14" strokeOpacity="0.7" />
      <rect x="16" y="20" width="16" height="5" rx="1" strokeOpacity="0.5" />
      <rect x="34" y="20" width="6" height="5" rx="1" fill={ACCENT} stroke="none" />
    </Frame>
  );
}

function CTAGradientBanner({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <rect x="2" y="2" width="52" height="36" rx="2" fill={ACCENT} fillOpacity="0.85" stroke="none" />
      <line x1="6" y1="14" x2="36" y2="14" stroke="currentColor" strokeOpacity="0.9" />
      <line x1="6" y1="20" x2="32" y2="20" stroke="currentColor" strokeOpacity="0.7" />
      <rect x="40" y="20" width="10" height="6" rx="1.5" fill="currentColor" fillOpacity="0.9" stroke="none" />
    </Frame>
  );
}

// ─── V1-derived wireframes ───────────────────────────────────────────────────

function HeroAnimatedGradient({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <rect x="14" y="6" width="28" height="3" rx="1" strokeOpacity="0.4" />
      <line x1="10" y1="16" x2="46" y2="16" stroke={ACCENT} strokeWidth="2.2" />
      <line x1="14" y1="22" x2="42" y2="22" strokeOpacity="0.5" />
      <rect x="20" y="27" width="6" height="4" rx="1" stroke={ACCENT} />
      <rect x="28" y="27" width="6" height="4" rx="1" strokeOpacity="0.4" />
      {/* Aurora hint */}
      <line x1="22" y1="16" x2="32" y2="16" stroke={ACCENT} strokeWidth="2.6" strokeOpacity="0.55" />
    </Frame>
  );
}

function HeroLogoStrip({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="14" y1="10" x2="42" y2="10" strokeOpacity="0.4" />
      <line x1="10" y1="15" x2="46" y2="15" stroke={ACCENT} strokeWidth="1.8" />
      <line x1="16" y1="20" x2="40" y2="20" strokeOpacity="0.5" />
      <rect x="22" y="24" width="5" height="3" rx="0.8" stroke={ACCENT} />
      <rect x="29" y="24" width="5" height="3" rx="0.8" strokeOpacity="0.4" />
      {/* Marquee logos row */}
      <g strokeOpacity="0.4">
        <rect x="4" y="32" width="6" height="3" rx="0.5" />
        <rect x="12" y="32" width="6" height="3" rx="0.5" />
        <rect x="20" y="32" width="6" height="3" rx="0.5" />
        <rect x="28" y="32" width="6" height="3" rx="0.5" />
        <rect x="36" y="32" width="6" height="3" rx="0.5" />
        <rect x="44" y="32" width="6" height="3" rx="0.5" />
      </g>
    </Frame>
  );
}

function GridTestimonials3Col({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="14" y1="6" x2="42" y2="6" strokeOpacity="0.4" />
      <rect x="5" y="12" width="14" height="22" rx="1.5" strokeOpacity="0.5" />
      <rect x="21" y="12" width="14" height="22" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <rect x="37" y="12" width="14" height="22" rx="1.5" strokeOpacity="0.5" />
      <circle cx="8.5" cy="28" r="1.5" strokeOpacity="0.6" />
      <circle cx="24.5" cy="28" r="1.5" fill={ACCENT} stroke="none" />
      <circle cx="40.5" cy="28" r="1.5" strokeOpacity="0.6" />
    </Frame>
  );
}

function GridPricing2Tier({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="18" y1="6" x2="38" y2="6" strokeOpacity="0.5" />
      <rect x="7" y="11" width="20" height="22" rx="1.5" strokeOpacity="0.55" />
      <line x1="11" y1="16" x2="17" y2="16" strokeOpacity="0.6" />
      <line x1="11" y1="20" x2="23" y2="20" strokeOpacity="0.4" />
      <rect x="29" y="9" width="20" height="26" rx="1.5" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="33" y1="14" x2="39" y2="14" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="33" y1="18" x2="45" y2="18" strokeOpacity="0.7" />
      <rect x="33" y="28" width="10" height="3" rx="1" fill={ACCENT} stroke="none" />
    </Frame>
  );
}

function FAQAccordionWire({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="20" y1="5" x2="36" y2="5" strokeOpacity="0.4" />
      <g>
        <line x1="6" y1="11" x2="44" y2="11" strokeOpacity="0.7" />
        <path d="M48 11l2 1.5L48 12l2-1.5z" stroke={ACCENT} strokeWidth="1.4" />
        <line x1="48" y1="11.2" x2="50" y2="11.2" strokeOpacity="0" />
        <text x="49" y="13" fontSize="3.5" fill={ACCENT} stroke="none" textAnchor="middle" />
      </g>
      <g strokeOpacity="0.6">
        <line x1="6" y1="11" x2="50" y2="11" strokeOpacity="0.7" />
        <line x1="6" y1="18" x2="48" y2="18" />
        <line x1="6" y1="25" x2="46" y2="25" />
        <line x1="6" y1="32" x2="50" y2="32" />
        <line x1="2" y1="14" x2="54" y2="14" strokeOpacity="0.25" />
        <line x1="2" y1="21" x2="54" y2="21" strokeOpacity="0.25" />
        <line x1="2" y1="28" x2="54" y2="28" strokeOpacity="0.25" />
        <line x1="2" y1="35" x2="54" y2="35" strokeOpacity="0.25" />
      </g>
      {/* Plus icons */}
      <g stroke={ACCENT} strokeWidth="1.2">
        <line x1="46.5" y1="11" x2="49.5" y2="11" />
        <line x1="48" y1="9.5" x2="48" y2="12.5" />
        <line x1="46.5" y1="25" x2="49.5" y2="25" strokeOpacity="0.6" stroke="currentColor" />
        <line x1="48" y1="23.5" x2="48" y2="26.5" strokeOpacity="0.6" stroke="currentColor" />
      </g>
    </Frame>
  );
}

function FooterFourCol({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="2" y1="9" x2="54" y2="9" strokeOpacity="0.3" />
      {/* 4 cols of small links */}
      <g strokeOpacity="0.55">
        <line x1="5" y1="15" x2="11" y2="15" stroke={ACCENT} strokeOpacity="1" strokeWidth="1.4" />
        <line x1="5" y1="19" x2="13" y2="19" />
        <line x1="5" y1="23" x2="11" y2="23" />
        <line x1="5" y1="27" x2="12" y2="27" />
      </g>
      <g strokeOpacity="0.55">
        <line x1="18" y1="15" x2="24" y2="15" />
        <line x1="18" y1="19" x2="26" y2="19" />
        <line x1="18" y1="23" x2="24" y2="23" />
        <line x1="18" y1="27" x2="22" y2="27" />
      </g>
      <g strokeOpacity="0.55">
        <line x1="31" y1="15" x2="37" y2="15" />
        <line x1="31" y1="19" x2="39" y2="19" />
        <line x1="31" y1="23" x2="35" y2="23" />
        <line x1="31" y1="27" x2="38" y2="27" />
      </g>
      <g strokeOpacity="0.55">
        <line x1="44" y1="15" x2="50" y2="15" />
        <line x1="44" y1="19" x2="52" y2="19" />
        <line x1="44" y1="23" x2="48" y2="23" />
      </g>
      <line x1="2" y1="33" x2="54" y2="33" strokeOpacity="0.25" />
      <circle cx="48" cy="36" r="1" strokeOpacity="0.4" />
      <circle cx="51" cy="36" r="1" strokeOpacity="0.4" />
      <line x1="5" y1="36" x2="22" y2="36" strokeOpacity="0.3" />
    </Frame>
  );
}

function FooterMinimal({ size, className }: WireframeProps) {
  return (
    <Frame size={size} className={className}>
      <line x1="2" y1="14" x2="54" y2="14" strokeOpacity="0.25" />
      <rect x="6" y="18" width="6" height="3" rx="0.5" stroke={ACCENT} strokeWidth="1.4" />
      <line x1="14" y1="20" x2="22" y2="20" strokeOpacity="0.4" />
      <g strokeOpacity="0.55">
        <line x1="30" y1="20" x2="34" y2="20" />
        <line x1="37" y1="20" x2="41" y2="20" />
        <line x1="44" y1="20" x2="48" y2="20" />
      </g>
      <circle cx="51" cy="20" r="1" strokeOpacity="0.4" />
    </Frame>
  );
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const LAYOUT_WIREFRAMES: Record<string, (p: WireframeProps) => ReactNode> = {
  // V3 core
  "hero-centered": HeroCentered,
  "hero-split": HeroSplit,
  "hero-asymmetric": HeroAsymmetric,
  "stack-vertical-cards": StackVerticalCards,
  "stack-alternating": StackAlternatingRows,
  "stack-icon-grid": StackIconGrid,
  "split-side-by-side": SplitSideBySide,
  "split-comparison": SplitComparisonTable,
  "split-before-after": SplitBeforeAfter,
  "grid-logo-bar": GridLogoBar,
  "grid-feature-3col": GridFeature3,
  "grid-testimonials": GridTestimonialMasonry,
  "grid-stats-4": GridStats4,
  "grid-pricing-3": GridPricing3,
  "cta-centered": CTACenteredBanner,
  "cta-card-form": CTACardForm,
  "cta-gradient": CTAGradientBanner,
  // V1-derived
  "hero-animated-gradient": HeroAnimatedGradient,
  "hero-logo-strip": HeroLogoStrip,
  "grid-testimonials-3": GridTestimonials3Col,
  "grid-pricing-2": GridPricing2Tier,
  "faq-accordion": FAQAccordionWire,
  "footer-four-col": FooterFourCol,
  "footer-minimal": FooterMinimal,
};

export function LayoutWireframe({
  layoutId,
  size,
  className,
}: {
  layoutId: string;
  size?: number;
  className?: string;
}) {
  const C = LAYOUT_WIREFRAMES[layoutId];
  if (!C) {
    return (
      <Frame size={size} className={className}>
        <line x1="14" y1="20" x2="42" y2="20" strokeOpacity="0.4" />
      </Frame>
    );
  }
  return <C size={size} className={className} />;
}
