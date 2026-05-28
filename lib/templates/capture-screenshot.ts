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

import puppeteer, { type Browser } from "puppeteer";
import { getTemplate, setTemplateScreenshot } from "./store";
import { getTemplateStorage } from "@/lib/storage/templates";

export const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
export const SCREENSHOT_JPEG_QUALITY = 82;
// Full-page renders of dense editorial templates take longer than the
// above-the-fold thumbnail capture, so the timeout is a touch higher.
const PAGE_TIMEOUT_MS = 45_000;
const POST_LOAD_SETTLE_MS = 350;

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
    await page.goto(target.storageUrl, {
      waitUntil: "networkidle0",
      timeout: PAGE_TIMEOUT_MS,
    });
    // Wait for web fonts so the capture isn't the FOUT fallback.
    await page.evaluate(() =>
      "fonts" in document ? document.fonts.ready : Promise.resolve(),
    );
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));

    const jpeg = (await page.screenshot({
      type: "jpeg",
      quality: SCREENSHOT_JPEG_QUALITY,
      fullPage: true,
    })) as Buffer;

    const key = `screenshots/${target.id}-${target.contentHash}.jpg`;
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
