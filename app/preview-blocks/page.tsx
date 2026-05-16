// ─────────────────────────────────────────────────────────────────────────────
// /preview-blocks — visual QA route for the block library.
//
// Renders every block in BLOCK_REGISTRY with its exampleSlots against the
// selected palette. Default = mono-dark. Switch palette via the URL search
// param `?palette=indigo-dark` (or any of the five PaletteName values).
//
// This is a dev tool, NOT production output. It is intentionally simple — no
// per-block isolation, no chrome around each block. Scroll the page; what
// you see is what an end user would see at the same point in a real
// generated page.
// ─────────────────────────────────────────────────────────────────────────────

import { BLOCK_IDS, getBlock } from "@/lib/blocks/_registry";
import { paletteToTokens } from "@/lib/blocks/palette-to-tokens";
import type { PaletteName } from "@/lib/orchestrator/design-tokens";

export const dynamic = "force-static";

const VALID_PALETTES: PaletteName[] = [
  "mono-dark",
  "indigo-dark",
  "emerald-dark",
  "warm-dark",
  "mono-light",
];

function parsePalette(raw: string | string[] | undefined): PaletteName {
  if (typeof raw === "string" && (VALID_PALETTES as string[]).includes(raw)) {
    return raw as PaletteName;
  }
  return "mono-dark";
}

export default async function PreviewBlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ palette?: string }>;
}) {
  const params = await searchParams;
  const palette = parsePalette(params.palette);
  const tokens = paletteToTokens(palette);

  return (
    <div style={{ background: tokens.bg, color: tokens.text, minHeight: "100vh" }}>
      <header
        style={{
          background: tokens.surface,
          borderBottom: `1px solid ${tokens.border}`,
          fontFamily: tokens.fontBody,
        }}
        className="sticky top-0 z-50 px-6 py-4"
      >
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="text-sm font-medium"
              style={{ fontFamily: tokens.fontDisplay, color: tokens.text }}
            >
              Inari · Block Library Preview
            </span>
            <span className="text-xs" style={{ color: tokens.textDim }}>
              {BLOCK_IDS.length} blocks · palette: {palette}
            </span>
          </div>
          <nav className="flex flex-wrap gap-2 text-xs">
            {VALID_PALETTES.map((p) => (
              <a
                key={p}
                href={`?palette=${p}`}
                className="px-3 py-1.5 transition-colors"
                style={{
                  background: p === palette ? tokens.accent : "transparent",
                  color: p === palette ? tokens.accentFg : tokens.textMuted,
                  border: `1px solid ${p === palette ? tokens.accent : tokens.border}`,
                  borderRadius: tokens.radius,
                }}
              >
                {p}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {BLOCK_IDS.map((id) => {
        const { meta, Component } = getBlock(id);
        return (
          <div key={id} className="relative">
            <div
              className="sticky top-[60px] z-40 px-6 py-2 text-xs"
              style={{
                background: tokens.surfaceElevated,
                borderTop: `1px solid ${tokens.border}`,
                borderBottom: `1px solid ${tokens.border}`,
                color: tokens.textDim,
                fontFamily: tokens.fontMono,
              }}
            >
              <span style={{ color: tokens.accent }}>{id}</span>
              <span className="mx-2">·</span>
              <span>{meta.displayName}</span>
              <span className="mx-2">·</span>
              <span>aesthetics: {meta.aesthetics.join(", ")}</span>
            </div>
            {/* @ts-expect-error — generic schema makes slot type opaque to the registry index */}
            <Component slots={meta.exampleSlots} tokens={tokens} />
          </div>
        );
      })}
    </div>
  );
}
