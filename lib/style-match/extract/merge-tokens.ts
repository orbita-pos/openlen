import type { ScrapeResult } from "../types";
import { extractColors } from "./colors";
import { extractRadius, extractShadows } from "./radius-shadows";
import { extractSpacing } from "./spacing";
import { extractTypography } from "./typography";
import type { ExtractedTokens } from "./types";

export function extractTokens(scrape: ScrapeResult): ExtractedTokens {
  const cs = scrape.computedStyles;
  if (!cs) {
    throw new Error(
      "extractTokens requires a rendered ScrapeResult (Tier 2/3) — Tier 1 raw HTML has no computed styles",
    );
  }

  return {
    source: {
      url: scrape.url,
      hostname: scrape.hostname,
      finalUrl: scrape.finalUrl,
      extractedAt: new Date().toISOString(),
    },
    color: extractColors(cs.elements, cs.documentHeight, cs.documentWidth),
    typography: extractTypography(cs.elements),
    spacing: extractSpacing(cs.elements),
    radius: extractRadius(cs.elements),
    shadow: extractShadows(cs.elements),
  };
}
