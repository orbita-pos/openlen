// 8 hand-tuned background components — each parameterised by brandHue.
// Self-contained CSS + inline SVG. Server-renderable.
//
// Ported from claude.ai design-foundations artifact (May 2026).

import { useId } from "react";

export interface BackgroundProps {
  brandHue: number;
  className?: string;
}

// ───────────────── 1. MeshGrain ─────────────────

export function MeshGrain({ brandHue, className = "" }: BackgroundProps) {
  const id = useId().replace(/:/g, "");
  const base = `oklch(11% 0.015 ${brandHue})`;
  const c1 = `oklch(58% 0.22 ${brandHue})`;
  const c2 = `oklch(55% 0.20 ${(brandHue + 40) % 360})`;
  const c3 = `oklch(50% 0.18 ${(brandHue + 320) % 360})`;
  const c4 = `oklch(45% 0.16 ${(brandHue + 180) % 360})`;
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <div
        className="absolute inset-0"
        style={{
          background:
            `radial-gradient(60% 50% at 18% 30%, ${c1} 0%, transparent 60%),` +
            `radial-gradient(50% 45% at 82% 24%, ${c2} 0%, transparent 60%),` +
            `radial-gradient(55% 60% at 70% 80%, ${c3} 0%, transparent 60%),` +
            `radial-gradient(40% 35% at 30% 75%, ${c4} 0%, transparent 60%)`,
          mixBlendMode: "screen",
          filter: "saturate(1.05)",
        }}
      />
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <filter id={"g" + id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${id})`} opacity="0.06" />
      </svg>
    </div>
  );
}

// ───────────────── 2. ConicSweep ─────────────────

export function ConicSweep({ brandHue, className = "" }: BackgroundProps) {
  const base = `oklch(11% 0.01 ${brandHue})`;
  const c1 = `oklch(60% 0.22 ${brandHue})`;
  const c2 = `oklch(55% 0.20 ${(brandHue + 90) % 360})`;
  const c3 = `oklch(50% 0.18 ${(brandHue + 200) % 360})`;
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <div
        className="absolute inset-[-25%] openlen-conic"
        style={{
          background: `conic-gradient(from var(--angle, 0deg) at 50% 50%, ${base}, ${c1}, ${c2}, ${c3}, ${c1}, ${base})`,
          WebkitMaskImage: "radial-gradient(55% 45% at 50% 50%, #000 0%, transparent 75%)",
          maskImage: "radial-gradient(55% 45% at 50% 50%, #000 0%, transparent 75%)",
          filter: "blur(8px)",
        }}
      />
    </div>
  );
}

// ───────────────── 3. HalftoneDots ─────────────────

// ───────────────── 4. BlobBurst ─────────────────

export function BlobBurst({ brandHue, className = "" }: BackgroundProps) {
  const id = useId().replace(/:/g, "");
  const base = `oklch(11% 0.01 ${brandHue})`;
  const c1 = `oklch(62% 0.24 ${brandHue})`;
  const c2 = `oklch(55% 0.20 ${(brandHue + 60) % 360})`;
  const c3 = `oklch(50% 0.18 ${(brandHue + 280) % 360})`;
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <svg
        viewBox="0 0 400 225"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        style={{ filter: "blur(28px)" }}
        aria-hidden
      >
        <defs>
          <radialGradient id={"b1" + id}>
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c1} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={"b2" + id}>
            <stop offset="0%" stopColor={c2} />
            <stop offset="100%" stopColor={c2} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={"b3" + id}>
            <stop offset="0%" stopColor={c3} />
            <stop offset="100%" stopColor={c3} stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M 80 120 C 40 60, 140 30, 180 70 C 220 110, 160 180, 110 170 C 70 165, 100 150, 80 120 Z" fill={`url(#b1${id})`} />
        <path d="M 290 90 C 250 40, 360 50, 370 110 C 380 170, 300 180, 270 150 C 240 130, 310 130, 290 90 Z" fill={`url(#b2${id})`} />
        <path d="M 180 180 C 140 150, 250 140, 270 190 C 290 230, 200 230, 180 180 Z" fill={`url(#b3${id})`} />
      </svg>
    </div>
  );
}

// ───────────────── 5. NoiseOverlay ─────────────────

export function NoiseOverlay({ brandHue, className = "" }: BackgroundProps) {
  const id = useId().replace(/:/g, "");
  const base = `oklch(96% 0.025 ${brandHue})`;
  // A faint brand-tinted radial keeps the surface from looking flat at any
  // size; the turbulence noise overlays it for the grain feel.
  const tint = `oklch(86% 0.08 ${brandHue})`;
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(80% 70% at 18% 0%, ${tint}, transparent 60%)`,
          opacity: 0.6,
        }}
      />
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <filter id={"n" + id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#n${id})`} opacity="0.12" />
      </svg>
    </div>
  );
}

// ───────────────── 6. AnimatedMesh ─────────────────

export function AnimatedMesh({ brandHue, className = "" }: BackgroundProps) {
  const id = useId().replace(/:/g, "");
  const base = `oklch(11% 0.015 ${brandHue})`;
  const c1 = `oklch(60% 0.22 ${brandHue})`;
  const c2 = `oklch(55% 0.20 ${(brandHue + 50) % 360})`;
  const c3 = `oklch(50% 0.18 ${(brandHue + 280) % 360})`;
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <div
        className="absolute inset-0 openlen-animesh"
        style={{
          background:
            `radial-gradient(45% 40% at var(--m-x1,20%) var(--m-y1,30%), ${c1} 0%, transparent 60%),` +
            `radial-gradient(50% 45% at var(--m-x2,80%) var(--m-y2,30%), ${c2} 0%, transparent 60%),` +
            `radial-gradient(55% 50% at var(--m-x3,50%) var(--m-y3,80%), ${c3} 0%, transparent 60%)`,
          mixBlendMode: "screen",
        }}
      />
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <filter id={"an" + id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#an${id})`} opacity="0.05" />
      </svg>
    </div>
  );
}

// ───────────────── 7. BrandPattern ─────────────────

export function BrandPattern({ brandHue, className = "" }: BackgroundProps) {
  const id = useId().replace(/:/g, "");
  const base = `oklch(98% 0.005 ${brandHue})`;
  const mark = `oklch(58% 0.22 ${brandHue})`;
  // Tighter pattern + heavier stroke + higher opacity so the stamp reads at
  // small thumb sizes too.
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <pattern id={"p" + id} width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M11 6 V16 M6 11 H16" stroke={mark} strokeWidth="1.4" strokeLinecap="square" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#p${id})`} opacity="0.22" />
      </svg>
      <div
        className="absolute inset-x-0 bottom-0 h-px"
        style={{ background: `oklch(70% 0.012 ${brandHue} / 0.6)` }}
      />
    </div>
  );
}

// ───────────────── 8. MinimalSolid ─────────────────

export function MinimalSolid({ brandHue, className = "" }: BackgroundProps) {
  const base = `oklch(98% 0.005 ${brandHue})`;
  const rule = `oklch(78% 0.04 ${brandHue})`;
  const accent = `oklch(58% 0.22 ${brandHue})`;
  // Two hairlines + a small accent dot give MinimalSolid a recognisable
  // signature at any size (just a 1px rule disappears in a 74×41 thumb).
  return (
    <div className={"relative overflow-hidden " + className} style={{ background: base }}>
      <div className="absolute inset-x-0" style={{ top: "38%", height: "1px", background: rule }} />
      <div className="absolute inset-x-0" style={{ top: "62%", height: "1px", background: rule, opacity: 0.4 }} />
      <div
        className="absolute"
        style={{
          top: "38%",
          left: "14%",
          width: "5px",
          height: "5px",
          marginTop: "-2px",
          borderRadius: "999px",
          background: accent,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry — the AI runtime + design panel both consume this.
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentType } from "react";

export interface BackgroundSpec {
  id: string;
  name: string;
  Component: ComponentType<BackgroundProps>;
  blurb: string;
}

export const BACKGROUND_PRESETS: BackgroundSpec[] = [
  { id: "mesh-grain",    name: "MeshGrain",     Component: MeshGrain,    blurb: "Stacked radial blobs · screen blend · turbulence" },
  { id: "conic-sweep",   name: "ConicSweep",    Component: ConicSweep,   blurb: "Animated conic · radial fade mask · 20s" },
  { id: "blob-burst",    name: "BlobBurst",     Component: BlobBurst,    blurb: "Organic blobs · blur 28px · dreamy" },
  { id: "noise-overlay", name: "NoiseOverlay",  Component: NoiseOverlay, blurb: "Solid OKLCH · 8% turbulence · simplest" },
  { id: "animated-mesh", name: "AnimatedMesh",  Component: AnimatedMesh, blurb: "Drifting mesh · @property · 30s" },
  { id: "brand-pattern", name: "BrandPattern",  Component: BrandPattern, blurb: "Plus-mark tile · 16% opacity · stamp" },
  { id: "minimal-solid", name: "MinimalSolid",  Component: MinimalSolid, blurb: "Solid + 1px rule · trust typography" },
];

export function getBackground(id: string): BackgroundSpec | undefined {
  return BACKGROUND_PRESETS.find(b => b.id === id);
}
