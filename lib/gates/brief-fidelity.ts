import { load } from "cheerio";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 7 — brief fidelity (deterministic).
//
// Extracts "load-bearing" facts from the raw brief — prices, dates, named
// people — and asserts each one appears verbatim in the rendered HTML text.
//
// Rationale (Session 6 → 7 finding): the fill step's `<brief>…</brief>`
// fidelity rules + the plan step's factsLedger both push the model toward
// preserving exact facts, but neither is a hard guarantee. This gate is the
// last-resort check that catches the cases the model rephrases or quietly
// drops ($99/mo → "around a hundred", "Sep 30" → "the end of September",
// "Pieter Levels" → "a well-known indie hacker").
//
// All violations are WARNING severity by design:
//   - False positives are realistic. A brief says "$29/mo" and the model
//     legitimately renders "$29 / month". A "Pieter Levels" mention may be
//     dropped intentionally if the brief lists more speakers than fit.
//   - Critical-severity here would re-trigger the refine loop, which already
//     burns budget on Session 6's larger issues. Warning lets the page ship
//     and surfaces in `meta.gateResults` so the operator sees it.
//
// Tightening to critical is fine once we have a fuzzy-match layer (Session 8+).
// ─────────────────────────────────────────────────────────────────────────────

interface BriefFacts {
  prices: string[];
  dates: string[];
  names: string[];
}

// Match e.g. "$29", "$29.99", "$29/mo", "$1,499/year", "$199/month".
const PRICE_REGEX = /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\/(?:mo|month|yr|year|user|seat))?/g;

// Match e.g. "Sep 30", "September 30", "Oct 15, 2026". Year is optional. We
// require a month word + a 1-2 digit day so "Sep 2026" alone doesn't match —
// that's a year reference, not a date the page must echo verbatim.
const DATE_REGEX =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:[a-z]+)?\.?\s+\d{1,2}(?:,\s*\d{4})?/g;

// Capitalised name heuristic: at least two consecutive Capitalised tokens. Skip
// common false positives ("New York" — a place, not a person; we don't penalise
// missing places). We strip a curated stop-list before commit.
const NAME_REGEX = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;
const NAME_STOPLIST = new Set([
  "New York",
  "San Francisco",
  "Los Angeles",
  "United States",
  "United Kingdom",
  "Hong Kong",
  "Mexico City",
  "Buenos Aires",
  "São Paulo",
  "Cape Town",
  "Silicon Valley",
  "Wall Street",
  "North America",
  "South America",
  "Latin America",
  "Show HN",
  "Hacker News",
  "Built With",
  "Inari Pages",
  "Pure HTML",
  "Open Source",
  "Privacy Policy",
  "Terms Of",
]);

export async function runBriefFidelityGate(
  ctx: GateContext,
): Promise<GateResult> {
  const start = Date.now();
  const violations: GateViolation[] = [];

  const brief = ctx.meta.brief ?? "";
  const facts = extractBriefFacts(brief);
  const visibleText = extractVisibleText(ctx.html);
  // Strip whitespace variants and casing so "$29 / month" vs "$29/month"
  // doesn't fire a false positive. Names stay case-sensitive — "pieter" vs
  // "Pieter" is a legitimate signal the page lost the proper noun.
  const normalizedHtml = visibleText.replace(/\s+/g, "");

  for (const price of facts.prices) {
    if (!normalizedHtml.includes(price.replace(/\s+/g, ""))) {
      violations.push({
        gate: "seo", // see "Why under the seo gate id" below
        severity: "warning",
        code: "brief-fidelity-missing-price",
        message: `Brief specifies price "${price}" but it isn't in the rendered page.`,
        suggestion:
          "Echo the exact price string in the pricing block, or update the brief if the omission is intentional.",
        evidence: { fact: price, kind: "price" },
      });
    }
  }

  for (const date of facts.dates) {
    if (!normalizedHtml.toLowerCase().includes(date.toLowerCase().replace(/\s+/g, ""))) {
      violations.push({
        gate: "seo",
        severity: "warning",
        code: "brief-fidelity-missing-date",
        message: `Brief specifies date "${date}" but it isn't in the rendered page.`,
        evidence: { fact: date, kind: "date" },
      });
    }
  }

  for (const name of facts.names) {
    // For names we match against the un-normalised visible text so casing
    // counts. We still strip whitespace so "Pieter\nLevels" hits.
    const compact = visibleText.replace(/\s+/g, "");
    if (!compact.includes(name.replace(/\s+/g, ""))) {
      violations.push({
        gate: "seo",
        severity: "warning",
        code: "brief-fidelity-missing-name",
        message: `Brief names "${name}" but the rendered page doesn't mention them.`,
        evidence: { fact: name, kind: "name" },
      });
    }
  }

  return {
    gate: "seo",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost: 0,
  };
}

// Exported for use by the SEO gate runner — keeps the brief-fidelity result
// under the existing `seo` GateId so we don't have to widen the GATE_IDS enum
// + everything downstream (witness recorder, badge UI, meta blob). The
// violations are independently identifiable via their `brief-fidelity-*`
// codes, so the operator can still filter on them.
//
// Why under the seo gate id: brief fidelity is a "does the rendered page
// honour the brief" check, which is the spiritual cousin of "does the
// rendered page honour SEO conventions". Both are deterministic, structural
// post-checks of the assembled HTML; bundling avoids the migration cost of a
// new 7th gate while preserving the violation taxonomy.
export function extractBriefFacts(brief: string): BriefFacts {
  const prices = uniqueMatches(brief, PRICE_REGEX);
  const dates = uniqueMatches(brief, DATE_REGEX);
  const names: string[] = [];
  for (const match of brief.matchAll(NAME_REGEX)) {
    const full = `${match[1]} ${match[2]}`;
    if (NAME_STOPLIST.has(full)) continue;
    if (names.includes(full)) continue;
    names.push(full);
  }
  return { prices, dates, names };
}

function uniqueMatches(text: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(regex)) {
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

function extractVisibleText(html: string): string {
  const $ = load(html);
  $("script, style, template, noscript").remove();
  return $("body").text() || $.root().text();
}
