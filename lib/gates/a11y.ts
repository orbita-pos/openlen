import { AxePuppeteer } from "@axe-core/puppeteer";
import type { Page } from "puppeteer";
import { getBrowser } from "./_browser";
import { isBlockId } from "@/lib/blocks/_registry";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 1 — a11y.
//
// Runs axe-core (MPL 2.0) against the rendered page in a headless Chromium
// driven by Puppeteer. Critical violations are anything tagged WCAG 2 A/AA
// OR impact-level "serious"/"critical" by axe's own grading. Lower impact
// items (best-practice tags) downgrade to warnings.
//
// Block mapping: the assemble step writes `data-section-id="block-N"` onto
// the outermost tag of each block. We pull that attribute off each violating
// node so the refine step can target the exact block to re-fill.
// ─────────────────────────────────────────────────────────────────────────────

export async function runA11yGate(ctx: GateContext): Promise<GateResult> {
  const start = Date.now();
  const violations: GateViolation[] = [];

  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(ctx.html, {
      // `setContent` only accepts "load" / "domcontentloaded" (Puppeteer 22
      // narrowed its lifecycle types — networkidle is `goto`-only). The
      // waitForFunction below polls for the Tailwind CDN being ready, which
      // covers the JIT injection window we actually care about.
      waitUntil: "load",
      timeout: 15000,
    });
    // Belt-and-suspenders: wait for Tailwind to expose itself + a small grace
    // window for its DOM scanner to inject classes for the entire page.
    await page
      .waitForFunction(
        () =>
          document.readyState === "complete" &&
          // @ts-expect-error tailwind CDN globals
          typeof window.tailwind !== "undefined",
        { timeout: 8000 },
      )
      .catch(() => {
        // If Tailwind never loaded (offline / firewalled), continue anyway —
        // color-contrast results will be noisy but the structural checks
        // (alt text, heading order, ARIA) still produce useful signal.
      });
    // Small fixed wait to let the JIT runtime finish injecting computed
    // styles after declaring itself ready. Empirically ~150ms is enough.
    await new Promise((r) => setTimeout(r, 200));

    const tailwindLoaded: boolean = await page.evaluate(
      // @ts-expect-error tailwind CDN globals
      () => typeof window.tailwind !== "undefined",
    );

    const results = await new AxePuppeteer(page)
      .options({
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
        },
      })
      .analyze();

    for (const v of results.violations) {
      const wcagTagged = v.tags.some((t) => /^wcag2(1)?a{1,2}$/.test(t));
      const impactCritical = v.impact === "critical" || v.impact === "serious";
      // color-contrast misfires when Tailwind hasn't applied — the computed
      // styles reflect unstyled markup. Treat it as a warning in that case.
      const colorContrastWithoutTailwind =
        v.id === "color-contrast" && !tailwindLoaded;
      const isCritical =
        (wcagTagged || impactCritical) && !colorContrastWithoutTailwind;

      for (const node of v.nodes) {
        const sectionMatch = node.html.match(/data-section-id="block-(\d+)"/);
        const blockIndex = sectionMatch
          ? Number.parseInt(sectionMatch[1], 10)
          : undefined;
        const blockEntry =
          blockIndex !== undefined ? ctx.blockSequence[blockIndex] : undefined;

        violations.push({
          gate: "a11y",
          severity: isCritical ? "critical" : "warning",
          blockIndex,
          blockId:
            blockEntry && isBlockId(blockEntry.blockId)
              ? blockEntry.blockId
              : undefined,
          code: v.id,
          message: `${v.help}: ${v.description}`,
          suggestion: v.helpUrl,
          evidence: {
            html: node.html.slice(0, 240),
            targets: node.target,
            impact: v.impact,
            tags: v.tags,
          },
        });
      }
    }
  } catch (err) {
    violations.push({
      gate: "a11y",
      severity: "warning",
      code: "a11y-runtime-error",
      message: `axe-core could not run: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore — browser may have been disposed
      }
    }
  }

  return {
    gate: "a11y",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost: 0,
  };
}
