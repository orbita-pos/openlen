import type { ScrapeError, ScrapeResult, ScrapeTarget } from "../types";

export async function fetchBrowserless(
  _target: ScrapeTarget,
): Promise<{ ok: true; value: ScrapeResult } | { ok: false; error: ScrapeError }> {
  return {
    ok: false,
    error: { kind: "not-implemented", tier: 3 },
  };
}
