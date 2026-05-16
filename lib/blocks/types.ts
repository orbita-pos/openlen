// ─────────────────────────────────────────────────────────────────────────────
// Block library — types & contract.
//
// Every block in lib/blocks/<category>/<variant>.tsx must export:
//   - meta: BlockMeta<S>       (id, displayName, description, aesthetics,
//                               slotsSchema, exampleSlots)
//   - Component: BlockComponent<S>  (pure renderer: slots × tokens → JSX)
//
// The orchestrator NEVER asks an LLM to write JSX. Instead it:
//   1. picks block IDs (plan step)
//   2. fills slot JSON validated by `slotsSchema` (section.fill step)
//   3. renders deterministically via _registry.ts (compose step)
//
// This file intentionally re-declares AestheticDirection independently of
// design-tokens.ts so lib/blocks/ stays self-contained (a future move out
// of the monorepo, or generating a separate published package, costs nothing).
// The two declarations must stay in sync — see also the import in
// _registry.ts which cross-checks at compile time.
// ─────────────────────────────────────────────────────────────────────────────

import type React from "react";
import type { z } from "zod";

export type AestheticDirection =
  | "technical-minimal"
  | "refined-editorial"
  | "warm-humanist"
  | "editorial-maximalist"
  | "brutalist-technical";

/**
 * Subset of design tokens injected into every block at render time. Mirrors
 * lib/orchestrator/design-tokens.ts `Palette` + typography keys the block
 * library actually consumes (we don't pipe the full type scale through every
 * component — let blocks reach for CSS clamp values instead).
 */
export interface BlockTokens {
  bg: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentHover: string;
  accentFg: string;
  radius: string;
  shadow: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
}

export interface BlockMeta<S extends z.ZodTypeAny> {
  /** Unique block ID, e.g. "hero/centered-cta". Matches _registry.ts key. */
  id: string;
  /** Human-readable name for UI / preview tooling. */
  displayName: string;
  /** One-line description used by the plan step's block picker. */
  description: string;
  /** Aesthetic directions this block fits well. */
  aesthetics: AestheticDirection[];
  /** Zod schema validating slot JSON returned by section.fill. */
  slotsSchema: S;
  /** Realistic example slots for preview + integration tests. */
  exampleSlots: z.infer<S>;
}

export interface BlockComponentProps<S extends z.ZodTypeAny> {
  slots: z.infer<S>;
  tokens: BlockTokens;
}

export type BlockComponent<S extends z.ZodTypeAny> = React.FC<
  BlockComponentProps<S>
>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-schemas. Blocks import these from this file rather than redefine
// to keep the schema language consistent (and to make slot-filling few-shots
// easier to write — fewer per-block variants).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Icon name → lucide-react icon. The enum is intentionally small (the AI is
 * already overwhelmed by choice). Add icons here as block needs grow.
 */
export const ICON_NAMES = [
  "sparkles",
  "code",
  "zap",
  "shield",
  "rocket",
  "globe",
  "layers",
  "wand",
  "gauge",
  "check",
  "star",
  "circuit",
  "cloud",
  "lock",
  "compass",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

// Session 7: widened from 5 → 10 platforms. Qwen3-235B fill consistently
// emitted "instagram", "tiktok", and "bluesky" outside the enum and had to
// fall back to Kimi (~$0.005/gen extra). Including the 2026-relevant ones
// here keeps fill on the cheap primary path. Order is rough cultural
// prominence; the AI picks per brief context.
export const SOCIAL_PLATFORMS = [
  "twitter",
  "github",
  "linkedin",
  "youtube",
  "discord",
  "instagram",
  "tiktok",
  "mastodon",
  "bluesky",
  "threads",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
