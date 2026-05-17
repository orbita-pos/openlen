// Background preset thumbs + project miniature thumbnails for the workspace
// v2 design panel and pages sidebar.
//
// Background thumbnails render the REAL components from
// `lib/design/presets/backgrounds.tsx` (MeshGrain, ConicSweep, HalftoneDots,
// BlobBurst, NoiseOverlay, AnimatedMesh, BrandPattern, MinimalSolid) — same
// source-of-truth that powers `/preview-v3`. Click a thumb → the iframe
// preview swaps backgrounds via `preview-doc.ts` which mirrors the same CSS.

"use client";

import type { ReactNode } from "react";
import { Check } from "./icons";
import { BACKGROUND_PRESETS } from "@/lib/design/presets/backgrounds";

// Build the bg renderer map directly from the canonical registry.
// Each entry maps a preset id (e.g. "mesh-grain") to the real component.
// The component fills its container via `absolute inset-0` — works at any
// size, so the same component renders premium at 44px thumb and full-bleed
// in the iframe.
export const BG_RENDER: Record<
  string,
  (p: { hue?: number }) => ReactNode
> = Object.fromEntries(
  BACKGROUND_PRESETS.map((b) => [
    b.id,
    ({ hue = 12 }: { hue?: number }) => (
      <b.Component brandHue={hue} className="absolute inset-0" />
    ),
  ]),
);

// Fallback used by <BgThumb> when an unknown id is passed.
function BgFallback({ hue = 12 }: { hue?: number }) {
  return (
    <div
      className="absolute inset-0"
      style={{ background: `oklch(98% 0.005 ${hue})` }}
    />
  );
}

interface BgThumbProps {
  id: string;
  label: string;
  active: boolean;
  hue: number;
  onClick: () => void;
}

export function BgThumb({ id, label, active, hue, onClick }: BgThumbProps) {
  const C = BG_RENDER[id] ?? BgFallback;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`group relative w-full overflow-hidden rounded-md transition ${
        active
          ? "ring-accent preset-pop"
          : "ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)]"
      }`}
    >
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        <C hue={hue} />
        {active && (
          <span className="absolute top-1 right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-sm">
            <Check size={9} stroke={3} />
          </span>
        )}
      </div>
      <div className="px-1.5 py-1 text-[9.5px] fg-muted text-left ui-small">
        {label}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Project miniature thumbnails (right sidebar pages list)
// ─────────────────────────────────────────────────────────────────────────────

function ProjAcme() {
  return (
    <div className="h-full w-full bg-[#0c0c0d] text-zinc-100 mini">
      <div className="px-2 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="inline-flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-sm bg-emerald-400" />
            <span className="font-semibold text-[6px]">Acme</span>
          </span>
          <span className="opacity-60 text-[4px]">Pricing · Docs · Login</span>
        </div>
        <div className="text-emerald-400/90 text-[3.5px] mb-0.5">
          Pricing · simple
        </div>
        <div className="text-[6px] font-bold leading-[1.05] tracking-tight">
          Pay for what
          <br />
          you ship.
        </div>
        <div className="mt-1 grid grid-cols-3 gap-0.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-sm ring-1 ring-zinc-700 p-0.5"
            >
              <div className="text-[3.5px] opacity-60">Tier {i}</div>
              <div className="text-[4.5px] font-bold">${i * 19}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjAcmeHome() {
  return (
    <div className="h-full w-full bg-[#0c0c0d] text-zinc-100 mini">
      <div className="px-2 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-[6px]">▲ Acme</span>
          <span className="opacity-60 text-[4px]">Home · Pricing · Docs</span>
        </div>
        <div className="text-[7px] font-bold leading-[1.05] tracking-tight">
          Ship serverless
          <br />
          in one command.
        </div>
        <div className="mt-1 flex gap-0.5">
          <span className="rounded bg-emerald-400 text-black px-1 py-[1px] text-[3.5px] font-semibold">
            Start free
          </span>
          <span className="rounded ring-1 ring-zinc-700 px-1 py-[1px] text-[3.5px]">
            Docs
          </span>
        </div>
      </div>
    </div>
  );
}

function ProjDrift() {
  return (
    <div className="h-full w-full bg-white text-zinc-900 mini">
      <div className="px-2 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="inline-flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-sm bg-[#FF5A36]" />
            <span className="font-bold text-[6px]">drift</span>
          </span>
          <span className="opacity-60 text-[4px]">Product · Login</span>
        </div>
        <div className="text-center">
          <div className="text-[7px] font-bold tracking-tight leading-[1.05]">
            Your inbox,
            <br />
            already replied.
          </div>
          <div className="mt-1 inline-flex items-center gap-0.5 rounded bg-[#FF5A36] text-white px-1 py-[1px] text-[3.5px] font-semibold">
            Try free →
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjLumen() {
  return (
    <div className="h-full w-full bg-gradient-to-b from-indigo-50 to-white mini text-zinc-900">
      <div className="px-2 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-[6px]">◆ Lumen</span>
          <span className="opacity-60 text-[4px]">Pricing · Sign in</span>
        </div>
        <div className="text-[6px] font-bold tracking-tight leading-[1.05]">
          Analytics without
          <br />
          the spreadsheet.
        </div>
        <div className="mt-1 flex items-end justify-between gap-0.5 h-4">
          {[3, 5, 4, 7, 6, 8, 7, 9, 8, 11, 10, 12].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: `${h * 7}%`,
                background: i % 3 === 0 ? "#FF5A36" : "#a5b4fc",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjIndieCon() {
  return (
    <div className="h-full w-full bg-gradient-to-br from-fuchsia-50 via-white to-cyan-50 mini text-zinc-900">
      <div className="px-2 pt-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-[6px]">IndieCon &apos;26</span>
          <span className="opacity-60 text-[4px]">Schedule</span>
        </div>
        <div className="text-[7px] font-extrabold leading-[1.0] tracking-tight">
          The biggest
          <br />
          indie hacker
          <br />
          weekend.
        </div>
        <div className="mt-1 inline-flex items-center gap-0.5 rounded bg-zinc-900 text-white px-1 py-[1px] text-[3.5px] font-semibold">
          Ticket — $39
        </div>
      </div>
    </div>
  );
}

export const PROJ_THUMBS: Record<string, () => ReactNode> = {
  acme: ProjAcme,
  acmeHome: ProjAcmeHome,
  drift: ProjDrift,
  lumen: ProjLumen,
  indiecon: ProjIndieCon,
};
