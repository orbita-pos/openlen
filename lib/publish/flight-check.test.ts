// Tests for the pure Lighthouse-result extraction of Flight Check. The
// full audit path (ephemeral server + Chrome + Lighthouse) is exercised by
// measureRelease against a real publish — see the verification notes in
// the feature memory; it needs a local Chrome so it stays out of CI.
//
// Run via: npm run test:node (tsx --test con el shim de "server-only").

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { extractFlightSummary, isForeignKeyViolation, type LhrLike } from "./flight-check";

function fixture(): LhrLike {
  return {
    categories: {
      performance: { score: 0.985 },
      accessibility: { score: 1 },
      "best-practices": { score: 0.74 },
      seo: { score: null },
    },
    audits: {
      "largest-contentful-paint": { score: 1, numericValue: 912.4 },
      "cumulative-layout-shift": { score: 1, numericValue: 0.00123 },
      "total-blocking-time": { score: 1, numericValue: 16.8 },
      "first-contentful-paint": { score: 1, numericValue: 640.2 },
      "speed-index": { score: 1, numericValue: 1102.9 },
      "total-byte-weight": { score: 1, numericValue: 184_320 },
      "network-requests": {
        score: null,
        details: { type: "table", items: [{}, {}, {}, {}] },
      },
      "render-blocking-resources": {
        score: 0.4,
        title: "Eliminate render-blocking resources",
        details: { type: "opportunity", overallSavingsMs: 480.7 },
      },
      "uses-responsive-images": {
        score: 0.85,
        title: "Properly size images",
        details: { type: "opportunity", overallSavingsMs: 1210.2 },
      },
      "unused-css-rules": {
        // score >= 0.9 — passing, must NOT surface as an opportunity
        score: 0.95,
        title: "Reduce unused CSS",
        details: { type: "opportunity", overallSavingsMs: 90 },
      },
    },
  };
}

test("scores are rounded 0-100, null categories stay null", () => {
  const s = extractFlightSummary(fixture());
  assert.equal(s.perfScore, 99);
  assert.equal(s.a11yScore, 100);
  assert.equal(s.bpScore, 74);
  assert.equal(s.seoScore, null);
});

test("metrics extracted: ms rounded, CLS keeps 3 decimals, bytes + requests", () => {
  const s = extractFlightSummary(fixture());
  assert.equal(s.lcpMs, 912);
  assert.equal(s.cls, 0.001);
  assert.equal(s.tbtMs, 17);
  assert.equal(s.fcpMs, 640);
  assert.equal(s.speedIndexMs, 1103);
  assert.equal(s.totalBytes, 184320);
  assert.equal(s.requestCount, 4);
});

test("opportunities: failing only, sorted by savings desc", () => {
  const s = extractFlightSummary(fixture());
  assert.deepEqual(
    s.opportunities.map((o) => o.id),
    ["uses-responsive-images", "render-blocking-resources"],
  );
  assert.equal(s.opportunities[0].savingsMs, 1210);
});

test("empty lhr degrades to all-null summary", () => {
  const s = extractFlightSummary({ categories: {}, audits: {} });
  assert.equal(s.perfScore, null);
  assert.equal(s.lcpMs, null);
  assert.equal(s.requestCount, null);
  assert.deepEqual(s.opportunities, []);
});

test("FK violation (proyecto borrado a mitad de la auditoría) se reconoce; otros errores no", () => {
  assert.equal(isForeignKeyViolation(Object.assign(new Error("insert"), { code: "23503" })), true);
  assert.equal(
    isForeignKeyViolation(Object.assign(new Error("wrapped"), { cause: { code: "23503" } })),
    true,
  );
  assert.equal(isForeignKeyViolation(Object.assign(new Error("dup"), { code: "23505" })), false);
  assert.equal(isForeignKeyViolation(new Error("boom")), false);
  assert.equal(isForeignKeyViolation(null), false);
});
