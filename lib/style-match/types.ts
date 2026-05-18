// Shared types for the Style Match feature.
// Pipeline: scrape (3-tier) → extract (programmatic + vision) → apply (ID-tagged ops).

export interface ScrapeTarget {
  url: string;
  viewport?: { width: number; height: number };
}

export type ScrapeTier = 1 | 2 | 3;

export interface ScrapeResult {
  url: string;
  hostname: string;
  finalUrl: string;
  html: string;
  rendered: boolean;
  screenshot?: Buffer;
  computedStyles?: ComputedStylesSweep;
  resolvedFonts?: ResolvedFont[];
  fetchedAt: Date;
  tier: ScrapeTier;
  durationMs: number;
  sizeBytes: number;
}

export type ScrapeError =
  | { kind: "invalid-url"; reason: string }
  | { kind: "ssrf-blocked"; reason: string }
  | { kind: "network"; message: string }
  | { kind: "non-html"; contentType: string }
  | { kind: "blocked"; status: number }
  | { kind: "challenge"; reason: string }
  | { kind: "too-large"; sizeBytes: number }
  | { kind: "timeout"; afterMs: number }
  | { kind: "not-implemented"; tier: ScrapeTier };

export interface ElementSnapshot {
  tag: string;
  role: string | null;
  rect: { width: number; height: number; top: number; left: number };
  zIndex: number;
  styles: {
    color: string;
    backgroundColor: string;
    borderColor: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    borderRadius: string;
    boxShadow: string;
    padding: string;
    margin: string;
    gap: string;
  };
}

export interface ComputedStylesSweep {
  elements: ElementSnapshot[];
  documentHeight: number;
  documentWidth: number;
}

export interface ResolvedFont {
  familyName: string;
  glyphCount: number;
  isCustomFont: boolean;
}

export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const USER_AGENT =
  "OpenLenBot/1.0 (+https://openlen.com/bot)";
