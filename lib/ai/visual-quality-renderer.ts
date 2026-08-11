import type { InlineImage } from "@/lib/ai-gateway";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

export const VISUAL_QUALITY_DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;
export const VISUAL_QUALITY_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const MAX_VIEWPORT_BYTES = 1024 * 1024;

export interface VisualQualityViewports {
  desktop: InlineImage;
  mobile: InlineImage;
  mobileOverflow?: boolean;
}

interface PageLike {
  setViewport(viewport: { width: number; height: number }): Promise<unknown>;
  setContent(html: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  evaluate(pageFunction: () => unknown): Promise<unknown>;
  screenshot(options: { type: "jpeg"; quality: number; fullPage: boolean }): Promise<Uint8Array>;
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<unknown>;
}

export interface VisualQualityRendererInternals {
  capture?: (html: string, viewport: { width: number; height: number }) => Promise<InlineImage | null>;
  launchBrowser?: () => Promise<BrowserLike>;
  installGuard?: (page: PageLike) => Promise<unknown>;
  settle?: () => Promise<unknown>;
}

function isBoundedJpeg(image: InlineImage | null): image is InlineImage {
  if (!image || image.mimeType !== "image/jpeg" || image.dataBase64.length === 0) return false;
  try {
    const bytes = Buffer.from(image.dataBase64, "base64");
    return bytes.length > 0 && bytes.length <= MAX_VIEWPORT_BYTES;
  } catch {
    return false;
  }
}

function hasDocumentHorizontalOverflow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  const rootScrollWidth = geometry.rootScrollWidth;
  const bodyScrollWidth = geometry.bodyScrollWidth;
  const clientWidth = geometry.clientWidth;
  if (![rootScrollWidth, bodyScrollWidth, clientWidth].every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)) return false;
  return Math.max(Number(rootScrollWidth), Number(bodyScrollWidth)) > Number(clientWidth) + 1;
}

async function defaultLaunchBrowser(): Promise<BrowserLike> {
  const puppeteer = (await import("puppeteer")).default;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: { ...process.env, HOME: "/tmp" },
  }) as unknown as BrowserLike;
}

async function captureWithBrowser(
  html: string,
  internals: VisualQualityRendererInternals,
): Promise<VisualQualityViewports | null> {
  const browser = await (internals.launchBrowser ?? defaultLaunchBrowser)();
  try {
    const page = await browser.newPage();
    const guard = internals.installGuard ?? ((candidate: PageLike) =>
      installSubresourceSsrfGuard(candidate as Parameters<typeof installSubresourceSsrfGuard>[0]));
    await guard(page);
    await page.setViewport(VISUAL_QUALITY_DESKTOP_VIEWPORT);
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });

    const images: InlineImage[] = [];
    let mobileOverflow = false;
    for (const viewport of [VISUAL_QUALITY_DESKTOP_VIEWPORT, VISUAL_QUALITY_MOBILE_VIEWPORT]) {
      if (viewport !== VISUAL_QUALITY_DESKTOP_VIEWPORT) await page.setViewport(viewport);
      await page.evaluate(() =>
        "fonts" in document ? document.fonts.ready : Promise.resolve(),
      );
      await (internals.settle ?? (() => new Promise((resolve) => setTimeout(resolve, 400))))();
      if (viewport === VISUAL_QUALITY_MOBILE_VIEWPORT) {
        const geometry = await page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          return {
            rootScrollWidth: root.scrollWidth,
            bodyScrollWidth: body?.scrollWidth ?? 0,
            clientWidth: Math.max(window.innerWidth, root.clientWidth),
          };
        });
        mobileOverflow = hasDocumentHorizontalOverflow(geometry);
      }
      const bytes = Buffer.from(await page.screenshot({ type: "jpeg", quality: 75, fullPage: false }));
      const image = { mimeType: "image/jpeg", dataBase64: bytes.toString("base64") };
      if (!isBoundedJpeg(image)) return null;
      images.push(image);
    }
    return { desktop: images[0]!, mobile: images[1]!, mobileOverflow };
  } finally {
    await browser.close();
  }
}

export async function renderVisualQualityViewports(
  html: string,
  internals: VisualQualityRendererInternals = {},
): Promise<VisualQualityViewports | null> {
  try {
    if (!internals.capture) return await captureWithBrowser(html, internals);
    const desktop = await internals.capture(html, VISUAL_QUALITY_DESKTOP_VIEWPORT);
    if (!isBoundedJpeg(desktop)) return null;
    const mobile = await internals.capture(html, VISUAL_QUALITY_MOBILE_VIEWPORT);
    if (!isBoundedJpeg(mobile)) return null;
    return { desktop, mobile };
  } catch {
    return null;
  }
}
