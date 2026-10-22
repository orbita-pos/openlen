// lib/stripe/twins/swap.ts — THE PUBLISHED SITE CARRIES THE LIVE IDS (spec local
// 2026-10-21-stripe-integration, §6.4). In the release (the pages' HTML, the
// app's bundle, the functions' bundle) each test id or test payment link that
// has a live twin is replaced by it; the sources don't change, so the canvas
// stays in test mode. Whole tokens only: an id that merely starts like a twin's
// is left alone. A product's own id (`curso`) is the same in both modes and is
// never touched.

import type { StripeObjectRow } from "../store";

/** Test id or test link → its live twin. */
export type TwinMap = ReadonlyMap<string, string>;

export function twinMapFrom(rows: readonly StripeObjectRow[]): TwinMap {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.liveId) continue;
    if (r.liveId !== r.testId) map.set(r.testId, r.liveId);
    if (r.testUrl && r.liveUrl && r.kind === "payment_link") map.set(r.testUrl, r.liveUrl);
  }
  return map;
}

const TOKEN = /https:\/\/buy\.stripe\.com\/test_[A-Za-z0-9]+|\b(?:prod|price|plink|shr|bpc|we)_[A-Za-z0-9]+/g;

export function swapTwins(text: string, map: TwinMap): string {
  if (map.size === 0) return text;
  return text.replace(TOKEN, (token) => map.get(token) ?? token);
}
