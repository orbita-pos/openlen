import { load } from "cheerio";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 6 — performance.
//
// Deterministic checks against the static HTML:
//   1. HTML byte size (critical > 200KB, warn > 100KB).
//   2. Images: every non-hero <img> must have loading="lazy".
//   3. Images: every <img> must declare width + height (CLS prevention).
//   4. Render-blocking scripts: only one is permitted (Tailwind CDN).
//
// These don't run a real headless browser — Lighthouse-style perf scoring is
// out of scope at this gate cost budget. The cheap static checks catch ~80%
// of the page-weight + layout-shift regressions we'd see in real generations.
// ─────────────────────────────────────────────────────────────────────────────

const SIZE_CRITICAL_KB = 200;
const SIZE_WARN_KB = 100;

export async function runPerformanceGate(
  ctx: GateContext,
): Promise<GateResult> {
  const start = Date.now();
  const violations: GateViolation[] = [];

  // ── 1. HTML byte size ──────────────────────────────────────────────────
  const sizeBytes = new TextEncoder().encode(ctx.html).length;
  const sizeKB = sizeBytes / 1024;

  if (sizeKB > SIZE_CRITICAL_KB) {
    violations.push({
      gate: "performance",
      severity: "critical",
      code: "html-size-exceeded",
      message: `HTML is ${sizeKB.toFixed(1)} KB — exceeds ${SIZE_CRITICAL_KB}KB ceiling.`,
      suggestion:
        "Trim block copy, remove unused decorative imagery, or move heavy assets to lazy-loaded sections.",
    });
  } else if (sizeKB > SIZE_WARN_KB) {
    violations.push({
      gate: "performance",
      severity: "warning",
      code: "html-size-high",
      message: `HTML is ${sizeKB.toFixed(1)} KB — above ${SIZE_WARN_KB}KB target.`,
    });
  }

  const $ = load(ctx.html);

  // ── 2 & 3. Per-image lazy-load + dimensions ───────────────────────────
  const images = $("img").toArray();
  images.forEach((img, idx) => {
    const $img = $(img);
    const loading = $img.attr("loading");
    const src = $img.attr("src");
    if (!src) return; // SSR placeholders sometimes elide the src — skip.

    const isHero = idx === 0;
    if (!isHero && loading !== "lazy") {
      violations.push({
        gate: "performance",
        severity: "warning",
        code: "image-not-lazy",
        message: `Image ${idx + 1} should declare loading="lazy" — only the hero image is allowed eager.`,
        evidence: { src: src.slice(0, 100) },
      });
    }

    const width = $img.attr("width");
    const height = $img.attr("height");
    if (!width || !height) {
      violations.push({
        gate: "performance",
        severity: "warning",
        code: "image-no-dimensions",
        message: `Image ${idx + 1} missing width and/or height attribute — causes cumulative layout shift.`,
        evidence: { src: src.slice(0, 100), width, height },
      });
    }
  });

  // ── 4. Render-blocking scripts ────────────────────────────────────────
  // Async, defer, ld+json, and inline Tailwind config don't block render.
  const renderBlocking = $("script").filter((_, el) => {
    const $el = $(el);
    if ($el.attr("async") !== undefined) return false;
    if ($el.attr("defer") !== undefined) return false;
    const type = $el.attr("type") ?? "";
    if (type === "application/ld+json") return false;
    if (type === "text/babel") return false;
    return true;
  }).length;

  if (renderBlocking > 1) {
    violations.push({
      gate: "performance",
      severity: "warning",
      code: "render-blocking-scripts",
      message: `${renderBlocking} render-blocking scripts; should be 0-1 (Tailwind CDN only).`,
      suggestion: "Add async or defer to non-critical scripts.",
    });
  }

  // ── 5. Large inline <style> — cheap CLS proxy ─────────────────────────
  // The wrap-document helper inlines a small :root token block; if it grows
  // beyond 8KB someone has crammed component CSS in there and we should flag.
  const inlineStyleBytes = $("style")
    .toArray()
    .reduce((acc, el) => acc + ($(el).html()?.length ?? 0), 0);
  if (inlineStyleBytes > 8 * 1024) {
    violations.push({
      gate: "performance",
      severity: "warning",
      code: "inline-style-bloat",
      message: `Inline <style> is ${(inlineStyleBytes / 1024).toFixed(1)}KB — should stay under 8KB.`,
    });
  }

  return {
    gate: "performance",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost: 0,
  };
}
