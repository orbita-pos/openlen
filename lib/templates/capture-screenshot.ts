// Full-page template screenshot capture — the multimodal AI reference
// pipeline (Quality S2). Shared by `scripts/templates/capture-screenshots.ts`
// (batch) and `scripts/templates-add.ts` (inline, single template).
//
// Distinct from generate-thumbnails.ts on purpose:
//   - fullPage: true        (whole aesthetic, not above-the-fold)
//   - JPEG quality 82        (vs AVIF q65 cards)
//   - screenshots/<id>-<hash>.jpg   (vs thumbnails/<id>-<hash>.avif)
//   - sets templates.screenshotUrl  (vs thumbnailUrl)
//
// Browser discovery mirrors the thumbnail script: prefer the system
// Chromium/Edge/Chrome at PUPPETEER_EXECUTABLE_PATH (Hetzner convention),
// fall back to Puppeteer's bundled Chrome.

import puppeteer, { type Browser, type Page } from "puppeteer";
import { getTemplate, setTemplateScreenshot } from "./store";
import { getTemplateStorage } from "@/lib/storage/templates";

export const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
export const SCREENSHOT_JPEG_QUALITY = 82;
// Full-page renders of dense editorial templates take longer than the
// above-the-fold thumbnail capture, so the timeout is a touch higher.
const PAGE_TIMEOUT_MS = 45_000;
const POST_LOAD_SETTLE_MS = 350;
// Bump when the capture logic changes. v2 = reduced-motion + animation-freeze
// + autoscroll, so scroll-reveal sections render instead of being captured
// blank/faint in the AI reference. Part of the object key → a bump re-captures
// every screenshot on the next run (no --force needed).
export const SCREENSHOT_VERSION = "v2";

export interface CaptureTarget {
  id: string;
  storageUrl: string;
  contentHash: string;
}

export async function launchScreenshotBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    // Heavy full-page templates (canvas/WebGL) can blow past the default 180s
    // CDP timeout on captureScreenshot — give them room.
    protocolTimeout: 300_000,
  });
}

// Scroll top→bottom so IntersectionObserver-based reveals fire, then back to
// top. Re-reads scrollHeight each tick (lazy growth) and caps the loop.
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      let ticks = 0;
      const timer = setInterval(() => {
        const max = document.body.scrollHeight;
        window.scrollBy(0, 500);
        y += 500;
        ticks += 1;
        if (y >= max || ticks > 200) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
    window.scrollTo(0, 0);
  });
}

/** Capture one template's full page, upload the JPG to storage, and persist
 *  screenshotUrl. Returns the public URL. Throws on any failure. */
export async function captureTemplateScreenshot(
  browser: Browser,
  target: CaptureTarget,
): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setViewport(SCREENSHOT_VIEWPORT);
    // Templates honor reduced-motion → reveal sections render statically.
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.goto(target.storageUrl, {
      waitUntil: "networkidle0",
      timeout: PAGE_TIMEOUT_MS,
    });
    // Wait for web fonts so the capture isn't the FOUT fallback.
    await page.evaluate(() =>
      "fonts" in document ? document.fonts.ready : Promise.resolve(),
    );
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));

    // Snap every animation/transition to its final FORWARDS state, then scroll
    // the whole page so IntersectionObserver reveals fire — otherwise a
    // full-page capture grabs below-the-fold reveal sections blank/faint.
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-timeline:auto!important;animation-range:normal!important;animation-duration:.001s!important;animation-delay:0s!important;animation-fill-mode:forwards!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}",
    });
    await autoScroll(page);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const jpeg = (await page.screenshot({
      type: "jpeg",
      quality: SCREENSHOT_JPEG_QUALITY,
      fullPage: true,
    })) as Buffer;

    const key = `screenshots/${target.id}-${target.contentHash}-${SCREENSHOT_VERSION}.jpg`;
    const storage = getTemplateStorage();
    const uploaded = await storage.upload({
      key,
      contentType: "image/jpeg",
      body: jpeg,
    });

    await setTemplateScreenshot(target.id, uploaded.url);
    return uploaded.url;
  } finally {
    await page.close();
  }
}

/** Capture a single template by id with its own short-lived browser. Used by
 *  `templates:add` so a freshly-added template gets its reference screenshot
 *  inline — a template without a screenshot silently loses the S2 vision
 *  boost, so the caller treats a throw here as fatal. */
export async function captureScreenshotForTemplate(id: string): Promise<string> {
  const t = await getTemplate(id);
  if (!t) {
    throw new Error(`captureScreenshotForTemplate: template "${id}" not found`);
  }
  const browser = await launchScreenshotBrowser();
  try {
    return await captureTemplateScreenshot(browser, {
      id: t.id,
      storageUrl: t.storageUrl,
      contentHash: t.contentHash,
    });
  } finally {
    await browser.close();
  }
}
