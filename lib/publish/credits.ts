// Defense-in-depth Unsplash attribution at publish time. The full contract +
// rationale lives in crates/html-engine/src/publish/credits.rs — this module
// is a thin TS surface so existing import paths (lib/publish/filesystem.ts)
// don't have to change.

import {
  consolidateUnsplashCredits as rustConsolidateUnsplashCredits,
  type ConsolidationResult,
  type UnsplashCredit,
} from "@/lib/html-engine";

export type { ConsolidationResult, UnsplashCredit };

export function consolidateUnsplashCredits(html: string): ConsolidationResult {
  return rustConsolidateUnsplashCredits(html);
}
