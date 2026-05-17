// 5 SVG decoration overlays. Drop on top of any solid background.
// Each accepts `intensity` (minimal | balanced | bold) and optionally `onLight`
// to flip blend modes for light surfaces.
//
// Ported from claude.ai design-foundations artifact (May 2026).

import { useId, type ComponentType } from "react";

export type DecorationIntensity = "minimal" | "balanced" | "bold";

export interface DecorationProps {
  brandHue: number;
  intensity?: DecorationIntensity;
  className?: string;
  onLight?: boolean;
}

// ───────────────── 1. MeshOverlay ─────────────────

export function MeshOverlay({
  brandHue,
  intensity = "balanced",
  className = "",
  onLight = false,
}: DecorationProps) {
  const op = { minimal: 0.20, balanced: 0.40, bold: 0.70 }[intensity];
  const c1 = `oklch(60% 0.22 ${brandHue})`;
  const c2 = `oklch(55% 0.20 ${(brandHue + 60) % 360})`;
  const c3 = `oklch(50% 0.18 ${(brandHue + 200) % 360})`;
  const c4 = `oklch(58% 0.20 ${(brandHue + 300) % 360})`;
  return (
    <div
      className={"absolute inset-0 pointer-events-none " + className}
      style={{
        mixBlendMode: onLight ? "multiply" : "screen",
        opacity: op,
        background:
          `radial-gradient(50% 50% at 15% 25%, ${c1} 0%, transparent 70%),` +
          `radial-gradient(45% 50% at 85% 30%, ${c2} 0%, transparent 70%),` +
          `radial-gradient(55% 50% at 70% 85%, ${c3} 0%, transparent 70%),` +
          `radial-gradient(40% 40% at 25% 80%, ${c4} 0%, transparent 70%)`,
      }}
    />
  );
}

// ───────────────── 2. GrainNoise ─────────────────

export function GrainNoise({ intensity = "balanced", className = "" }: DecorationProps) {
  const op = { minimal: 0.03, balanced: 0.06, bold: 0.12 }[intensity];
  const id = useId().replace(/:/g, "");
  return (
    <svg className={"absolute inset-0 w-full h-full pointer-events-none " + className} aria-hidden>
      <filter id={"gn" + id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#gn${id})`} opacity={op} />
    </svg>
  );
}

// ───────────────── 3. HalftoneGrid ─────────────────

export function HalftoneGrid({
  brandHue,
  intensity = "balanced",
  className = "",
  onLight = false,
}: DecorationProps) {
  const r = { minimal: 0.8, balanced: 1.2, bold: 1.8 }[intensity];
  const id = useId().replace(/:/g, "");
  const dot = onLight ? `oklch(25% 0.04 ${brandHue})` : `oklch(85% 0.04 ${brandHue})`;
  return (
    <svg className={"absolute inset-0 w-full h-full pointer-events-none " + className} aria-hidden>
      <defs>
        <pattern id={"htg" + id} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r={r} fill={dot} />
        </pattern>
        <radialGradient id={"htm" + id}>
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={"htk" + id}>
          <rect width="100%" height="100%" fill={`url(#htm${id})`} />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill={`url(#htg${id})`} mask={`url(#htk${id})`} opacity="0.6" />
    </svg>
  );
}

// ───────────────── 4. ConicSweepDecoration ─────────────────

export function ConicSweepDecoration({
  brandHue,
  intensity = "balanced",
  className = "",
}: DecorationProps) {
  const mask = { minimal: "30%", balanced: "50%", bold: "70%" }[intensity];
  const c1 = `oklch(62% 0.22 ${brandHue})`;
  const c2 = `oklch(55% 0.20 ${(brandHue + 120) % 360})`;
  const c3 = `oklch(50% 0.18 ${(brandHue + 240) % 360})`;
  return (
    <div
      className={"absolute inset-0 pointer-events-none openlen-conic " + className}
      style={{
        background: `conic-gradient(from var(--angle, 0deg) at 50% 50%, ${c1}, ${c2}, ${c3}, ${c1})`,
        WebkitMaskImage: `radial-gradient(${mask} ${mask} at 50% 50%, #000 0%, transparent 80%)`,
        maskImage: `radial-gradient(${mask} ${mask} at 50% 50%, #000 0%, transparent 80%)`,
        filter: "blur(10px)",
        mixBlendMode: "screen",
      }}
    />
  );
}

// ───────────────── 5. BlobBurstDecoration ─────────────────

export function BlobBurstDecoration({
  brandHue,
  intensity = "balanced",
  className = "",
  onLight = false,
}: DecorationProps) {
  const id = useId().replace(/:/g, "");
  const count = { minimal: 1, balanced: 2, bold: 3 }[intensity];
  const colors = [
    `oklch(62% 0.24 ${brandHue})`,
    `oklch(55% 0.22 ${(brandHue + 60) % 360})`,
    `oklch(50% 0.20 ${(brandHue + 280) % 360})`,
  ].slice(0, count);
  const blobs = [
    "M 80 120 C 40 60, 140 30, 180 70 C 220 110, 160 180, 110 170 C 70 165, 100 150, 80 120 Z",
    "M 290 90 C 250 40, 360 50, 370 110 C 380 170, 300 180, 270 150 C 240 130, 310 130, 290 90 Z",
    "M 180 180 C 140 150, 250 140, 270 190 C 290 230, 200 230, 180 180 Z",
  ].slice(0, count);
  return (
    <svg
      viewBox="0 0 400 225"
      preserveAspectRatio="xMidYMid slice"
      className={"absolute inset-0 w-full h-full pointer-events-none " + className}
      style={{ filter: "blur(40px)", mixBlendMode: onLight ? "multiply" : "screen" }}
      aria-hidden
    >
      <defs>
        {colors.map((c, i) => (
          <radialGradient key={i} id={`bb${id}_${i}`}>
            <stop offset="0%" stopColor={c} />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {blobs.map((d, i) => (
        <path key={i} d={d} fill={`url(#bb${id}_${i})`} />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export interface DecorationSpec {
  id: string;
  name: string;
  Component: ComponentType<DecorationProps>;
  blurb: string;
  knob: string;
}

export const DECORATION_PRESETS: DecorationSpec[] = [
  { id: "mesh-overlay", name: "MeshOverlay",           Component: MeshOverlay,            blurb: "Stacked radials · blend · opacity", knob: "opacity 20/40/70%" },
  { id: "grain-noise",  name: "GrainNoise",            Component: GrainNoise,             blurb: "feTurbulence · drop-in",            knob: "opacity 3/6/12%" },
  { id: "halftone",     name: "HalftoneGrid",          Component: HalftoneGrid,           blurb: "24px circles · radial mask",         knob: "r 0.8/1.2/1.8" },
  { id: "conic",        name: "ConicSweep",            Component: ConicSweepDecoration,   blurb: "Conic · hue+120/+240 · blur",        knob: "mask 30/50/70%" },
  { id: "blob",         name: "BlobBurst",             Component: BlobBurstDecoration,    blurb: "Organic SVG · blur 40px",            knob: "1 / 2 / 3 blobs" },
];

export function getDecoration(id: string): DecorationSpec | undefined {
  return DECORATION_PRESETS.find(d => d.id === id);
}
