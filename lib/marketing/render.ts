// Puppeteer render of a filled post template (lib/marketing/fill.ts) to a
// PNG, cached in R2 by content hash. Browser recipe mirrors
// lib/branding/og-card.ts's renderOgCard verbatim — same launch args,
// HOME=/tmp on Linux, watchdog, fonts.ready wait, error classification —
// just parameterized on POST_FORMAT_SIZES instead of a fixed 1200x630, and
// the HTML arrives already filled (no card builder here).

import { createHash } from "node:crypto";
import { captureException } from "@inariwatch/capture";
import { POST_FORMAT_SIZES, type PostFormat } from "./post-templates/families";

const HARD_DEADLINE_MS = 12_000;

/** Content-addressed cache key: contentHash pins the template body, the html
 *  hash pins the filled data — same post + same data always resolves to the
 *  same R2 object instead of re-rendering. */
export function renderCacheKey(contentHash: string, filledHtml: string): string {
  const dataHash = createHash("sha256").update(filledHtml, "utf8").digest("hex").slice(0, 16);
  return `marketing/${contentHash}-${dataHash}.png`;
}

/** Render a filled post template to a PNG at its format's exact pixel size.
 *  Bounded + soft-fail (returns null) — the route turns a null into a 503
 *  rather than ever blocking on a hung browser. */
export async function renderPostPng(html: string, format: PostFormat): Promise<Buffer | null> {
  const { width, height } = POST_FORMAT_SIZES[format];
  try {
    const { default: puppeteer } = await import("puppeteer");
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    // ProtectHome=read-only on the box → Chrome needs a writable HOME; /tmp is
    // PrivateTmp-isolated. Linux only (memory: puppeteer-hetzner-chrome).
    const launchEnv =
      process.platform === "linux"
        ? { ...process.env, HOME: "/tmp" }
        : process.env;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      env: launchEnv,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-crash-reporter",
      ],
    });
    const watchdog = setTimeout(() => {
      void browser.close().catch(() => {});
    }, HARD_DEADLINE_MS);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.setContent(html, { waitUntil: "load", timeout: HARD_DEADLINE_MS });
      await page
        .evaluate(() => ("fonts" in document ? document.fonts.ready : Promise.resolve()))
        .catch(() => {});
      const png = (await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width, height },
      })) as Buffer;
      return png;
    } finally {
      clearTimeout(watchdog);
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A launch/executable-class failure breaks the pipeline for EVERY post
    // render (e.g. a moved Chromium binary) — surface that; a transient
    // render hiccup for one post just soft-fails to a 503.
    if (/Failed to launch|spawn|ENOENT|executablePath|out of memory/i.test(msg)) {
      captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: "marketing-post-render" },
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[marketing-render] render failed", msg);
    }
    return null;
  }
}
