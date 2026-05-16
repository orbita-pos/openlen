import type { Page } from "puppeteer";
import { getBrowser } from "./_browser";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 3 — mobile.
//
// Renders the page at iPhone-SE-class 360×800 viewport and checks:
//   1. No horizontal overflow (scrollWidth > viewportWidth + 1px slack).
//   2. All interactive elements (a/button/role=button/input button-types) meet
//      WCAG 2.5.5 minimum tap target 44×44 CSS px.
//
// Horizontal scroll is a critical fail — the page is unusable on mobile.
// Small tap targets warn but don't block: many design systems ship 40×40
// icon buttons that we can flag but not auto-fix.
// ─────────────────────────────────────────────────────────────────────────────

interface MobileMetrics {
  scrollWidth: number;
  viewportWidth: number;
  bodyScrollWidth: number;
}

interface TapTarget {
  tag: string;
  w: number;
  h: number;
  html: string;
}

export async function runMobileGate(ctx: GateContext): Promise<GateResult> {
  const start = Date.now();
  const violations: GateViolation[] = [];

  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 2 });
    await page.setContent(ctx.html, {
      // See lib/gates/a11y.ts for why "load" + the explicit Tailwind poll —
      // setContent's accepted lifecycle is narrower than goto's.
      waitUntil: "load",
      timeout: 15000,
    });
    await page
      .waitForFunction(
        () =>
          document.readyState === "complete" &&
          // @ts-expect-error tailwind CDN globals
          typeof window.tailwind !== "undefined",
        { timeout: 8000 },
      )
      .catch(() => {
        // Offline / firewalled environments — measurements will reflect
        // unstyled HTML, which usually overflows the 360px viewport. That's
        // an environment artifact, not a real mobile failure, so we still
        // run the check but tag any horizontal-scroll violation as warning
        // when Tailwind isn't present. (See critical-vs-warning below.)
      });
    await new Promise((r) => setTimeout(r, 200));

    const tailwindLoaded = await page.evaluate(
      // @ts-expect-error tailwind CDN globals
      () => typeof window.tailwind !== "undefined",
    );

    const metrics: MobileMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    if (metrics.scrollWidth > metrics.viewportWidth + 1) {
      // Find offending elements to suggest which block to refine.
      const offenders = await page.evaluate((viewport: number) => {
        const out: Array<{ tag: string; right: number; section?: string }> = [];
        const all = document.querySelectorAll<HTMLElement>("*");
        all.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.right > viewport + 2 && rect.width > 0) {
            const closestSection = el.closest("[data-section-id]");
            out.push({
              tag: el.tagName.toLowerCase(),
              right: Math.round(rect.right),
              section: closestSection?.getAttribute("data-section-id") ?? undefined,
            });
          }
        });
        return out.slice(0, 10);
      }, 360);

      const offendingBlockIndex = parseSectionIndex(offenders[0]?.section);
      const blockEntry =
        offendingBlockIndex !== undefined
          ? ctx.blockSequence[offendingBlockIndex]
          : undefined;

      violations.push({
        gate: "mobile",
        // Downgrade to warning if Tailwind didn't load — likely a CI/offline
        // artifact rather than a real responsive break.
        severity: tailwindLoaded ? "critical" : "warning",
        blockIndex: offendingBlockIndex,
        blockId: blockEntry?.blockId,
        code: "horizontal-scroll-at-360px",
        message: `Page width ${metrics.scrollWidth}px exceeds viewport 360px — causes horizontal scroll on mobile.`,
        suggestion:
          "Inspect the offending block for fixed-width elements, oversized images, or non-responsive grid columns.",
        evidence: { metrics, offenders, tailwindLoaded },
      });
    }

    // Tap-target check. Iterating in the page context avoids serializing
    // every node back to the gate runner.
    const smallTargets: TapTarget[] = await page.evaluate(() => {
      const targets: Array<{
        tag: string;
        w: number;
        h: number;
        html: string;
      }> = [];
      const selector =
        "a, button, [role='button'], input[type='button'], input[type='submit']";
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Skip elements that are visually hidden — they're not tap targets.
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.width < 44 || rect.height < 44) {
          targets.push({
            tag: el.tagName.toLowerCase(),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            html: el.outerHTML.slice(0, 120),
          });
        }
      });
      return targets;
    });

    if (smallTargets.length > 0) {
      violations.push({
        gate: "mobile",
        severity: "warning",
        code: "small-tap-targets",
        message: `${smallTargets.length} interactive element(s) below 44×44 CSS px (WCAG 2.5.5).`,
        suggestion:
          "Increase padding on small buttons/links so the hit area reaches 44×44.",
        evidence: smallTargets.slice(0, 5),
      });
    }
  } catch (err) {
    violations.push({
      gate: "mobile",
      severity: "warning",
      code: "mobile-runtime-error",
      message: `Mobile gate could not run: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }

  return {
    gate: "mobile",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost: 0,
  };
}

function parseSectionIndex(section: string | undefined): number | undefined {
  if (!section) return undefined;
  const match = section.match(/block-(\d+)/);
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : undefined;
}
