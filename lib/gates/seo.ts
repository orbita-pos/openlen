import { load } from "cheerio";
import { runBriefFidelityGate } from "./brief-fidelity";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 4 — SEO + AEO (answer-engine optimization).
//
// Deterministic via cheerio. Checks the structural-SEO surface:
//   - Exactly one <h1>
//   - <meta name="description"> in 120-155 range (Google snippet sweet spot)
//   - Heading hierarchy (no h2 → h4 skips)
//   - og:title + og:description (social sharing)
//   - JSON-LD structured data (AEO — required for LLM citations + answer engines)
//   - Image alt text (image-search SEO + a11y reinforcement)
//
// Cost: $0. Critical fails: no h1, no meta description. Everything else is a
// warning — they hurt rank/share but don't make the page broken.
// ─────────────────────────────────────────────────────────────────────────────

export async function runSeoGate(ctx: GateContext): Promise<GateResult> {
  const start = Date.now();
  const $ = load(ctx.html);
  const violations: GateViolation[] = [];

  // ── 1. <h1> presence + uniqueness ──────────────────────────────────────
  const h1Count = $("h1").length;
  if (h1Count === 0) {
    violations.push({
      gate: "seo",
      severity: "critical",
      code: "no-h1",
      message: "Page has no <h1>.",
      suggestion:
        "Ensure the hero block renders an <h1> with the primary headline.",
    });
  } else if (h1Count > 1) {
    violations.push({
      gate: "seo",
      severity: "warning",
      code: "multiple-h1",
      message: `Page has ${h1Count} <h1> tags; should have exactly 1.`,
    });
  }

  // ── 2. Meta description ────────────────────────────────────────────────
  const desc = ($('meta[name="description"]').attr("content") ?? "").trim();
  if (!desc) {
    violations.push({
      gate: "seo",
      severity: "critical",
      code: "no-meta-description",
      message: 'Missing <meta name="description">.',
      suggestion: "Add a 120-155 character page description to <head>.",
    });
  } else if (desc.length < 80 || desc.length > 200) {
    violations.push({
      gate: "seo",
      severity: "warning",
      code: "meta-description-length",
      message: `Description is ${desc.length} chars; recommended 120-155.`,
    });
  }

  // ── 3. Heading hierarchy ───────────────────────────────────────────────
  const headings = $("h1, h2, h3, h4, h5, h6")
    .toArray()
    .map((h) => Number.parseInt(h.tagName[1], 10))
    .filter((n) => Number.isFinite(n));
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      violations.push({
        gate: "seo",
        severity: "warning",
        code: "heading-skip",
        message: `Heading hierarchy skips from h${headings[i - 1]} to h${headings[i]}.`,
        suggestion:
          "Tighten levels so headings step by ≤1 (h2 → h3, not h2 → h4).",
      });
      break;
    }
  }

  // ── 4. OG tags ─────────────────────────────────────────────────────────
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  if (!ogTitle || !ogDesc) {
    violations.push({
      gate: "seo",
      severity: "warning",
      code: "missing-og-tags",
      message: "Missing og:title or og:description for social sharing.",
      suggestion:
        "Add Open Graph meta tags so links unfurl with rich previews on Slack/Twitter/LinkedIn.",
    });
  }

  // ── 5. JSON-LD structured data (AEO) ───────────────────────────────────
  const jsonLdScripts = $('script[type="application/ld+json"]').toArray();
  if (jsonLdScripts.length === 0) {
    violations.push({
      gate: "seo",
      severity: "warning",
      code: "no-structured-data",
      message:
        "No JSON-LD structured data. AEO (answer engine optimization) needs schema.org markup.",
      suggestion:
        "Add Organization or Product schema.org JSON-LD in <head>.",
    });
  } else {
    for (const script of jsonLdScripts) {
      try {
        const text = $(script).html() ?? "";
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (!parsed["@context"] || !parsed["@type"]) {
          violations.push({
            gate: "seo",
            severity: "warning",
            code: "invalid-structured-data",
            message: "JSON-LD present but missing @context or @type.",
          });
        }
      } catch {
        violations.push({
          gate: "seo",
          severity: "warning",
          code: "malformed-structured-data",
          message: "JSON-LD script failed to parse.",
        });
      }
    }
  }

  // ── 6. Image alt text ──────────────────────────────────────────────────
  // We accept empty alt="" (decorative declaration) but flag missing attrs.
  const imagesWithoutAlt = $("img:not([alt])").length;
  if (imagesWithoutAlt > 0) {
    violations.push({
      gate: "seo",
      severity: "warning",
      code: "images-missing-alt",
      message: `${imagesWithoutAlt} image(s) missing alt attribute (use alt="" for decorative images).`,
    });
  }

  // ── 7. <title> ─────────────────────────────────────────────────────────
  const title = ($("title").text() ?? "").trim();
  if (!title) {
    violations.push({
      gate: "seo",
      severity: "critical",
      code: "no-title",
      message: "Page has no <title>.",
    });
  }

  // ── 8. Brief fidelity (Session 7) ─────────────────────────────────────
  // Riding under the seo gate id so we don't expand GATE_IDS — see comment in
  // brief-fidelity.ts for the rationale. The check is deterministic regex-on-
  // brief vs. rendered HTML; violations all warning severity.
  const fidelity = await runBriefFidelityGate(ctx);
  violations.push(...fidelity.violations);

  return {
    gate: "seo",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost: 0,
  };
}
