import type { ScrapeError, ScrapeResult, ScrapeTarget } from "../types";
import { fetchBrowserless } from "./fetch-browserless";
import { fetchPuppeteer } from "./fetch-puppeteer";
import { fetchRaw } from "./fetch-raw";

export interface OrchestrateResult {
  result?: ScrapeResult;
  attempts: Array<{ tier: 1 | 2 | 3; error?: ScrapeError; durationMs: number }>;
  finalError?: ScrapeError;
}

const FALL_THROUGH_ERRORS = new Set<ScrapeError["kind"]>([
  "blocked",
  "challenge",
  "timeout",
  "not-implemented",
]);

export async function orchestrate(target: ScrapeTarget): Promise<OrchestrateResult> {
  const attempts: OrchestrateResult["attempts"] = [];

  const tier1Start = Date.now();
  const tier1 = await fetchRaw(target);
  const tier1Duration = Date.now() - tier1Start;
  if (tier1.ok) {
    attempts.push({ tier: 1, durationMs: tier1Duration });
    return { result: tier1.value, attempts };
  }
  attempts.push({ tier: 1, error: tier1.error, durationMs: tier1Duration });
  if (!FALL_THROUGH_ERRORS.has(tier1.error.kind)) {
    return { attempts, finalError: tier1.error };
  }

  const tier2Start = Date.now();
  const tier2 = await fetchPuppeteer(target);
  const tier2Duration = Date.now() - tier2Start;
  if (tier2.ok) {
    attempts.push({ tier: 2, durationMs: tier2Duration });
    return { result: tier2.value, attempts };
  }
  attempts.push({ tier: 2, error: tier2.error, durationMs: tier2Duration });
  if (!FALL_THROUGH_ERRORS.has(tier2.error.kind)) {
    return { attempts, finalError: tier2.error };
  }

  const tier3Start = Date.now();
  const tier3 = await fetchBrowserless(target);
  const tier3Duration = Date.now() - tier3Start;
  if (tier3.ok) {
    attempts.push({ tier: 3, durationMs: tier3Duration });
    return { result: tier3.value, attempts };
  }
  attempts.push({ tier: 3, error: tier3.error, durationMs: tier3Duration });
  return { attempts, finalError: tier3.error };
}
