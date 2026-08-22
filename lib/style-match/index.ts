// Style Match infra — Phase 0+1 scraping/extraction utilities + vision call
// wrappers. Originally built for URL-based style transfer; the live OpenLen
// feature pivoted to template autofill (lib/style-match/autofill/) where
// image extraction reuses the Gemini vision client and html-ops reuses the
// ID-tagged ops protocol. The exports below stay for code that still needs
// scraping (none in production yet), and for any future re-introduction of
// URL-based extraction as a power-user feature.

export type {
  ComputedStylesSweep,
  ElementSnapshot,
  ResolvedFont,
  ScrapeError,
  ScrapeResult,
  ScrapeTarget,
  ScrapeTier,
} from "./types";

export type {
  ColorEntry,
  ColorTokens,
  ExtractedTokens,
  RadiusTokens,
  ShadowEntry,
  ShadowTokens,
  SpacingTokens,
  TypographyTokens,
} from "./extract/types";

export { orchestrate } from "./scrape/orchestrate";
export { fetchRaw } from "./scrape/fetch-raw";
export { fetchPuppeteer } from "./scrape/fetch-puppeteer";
export { validateUrl } from "./scrape/validate-url";
export { extractTokens } from "./extract/merge-tokens";
