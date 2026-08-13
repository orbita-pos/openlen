import type { InlineImage } from "@/lib/ai-gateway";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

export const VISUAL_QUALITY_DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;
export const VISUAL_QUALITY_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const MAX_VIEWPORT_BYTES = 1024 * 1024;
const DETERMINISTIC_RENDER_RESET = "<style data-openlen-deterministic-render-reset>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}}</style>";

export interface VisualQualityViewports {
  desktop: InlineImage;
  mobile: InlineImage;
  mobileOverflow?: boolean;
  weakTypographyHierarchy?: boolean;
  squareComponentTreatment?: boolean;
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

function injectDeterministicRenderReset(html: string): string {
  const openingHead = /<head\b[^>]*>/i.exec(html);
  if (openingHead?.index !== undefined) {
    const afterOpeningHead = openingHead.index + openingHead[0].length;
    return `${html.slice(0, afterOpeningHead)}${DETERMINISTIC_RENDER_RESET}${html.slice(afterOpeningHead)}`;
  }
  const openingBody = /<body\b/i.exec(html);
  if (openingBody?.index !== undefined) {
    return `${html.slice(0, openingBody.index)}<head>${DETERMINISTIC_RENDER_RESET}</head>${html.slice(openingBody.index)}`;
  }
  return `${DETERMINISTIC_RENDER_RESET}${html}`;
}

async function awaitDeterministicLayout(page: PageLike): Promise<void> {
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
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

function overflowGeometrySamplesDisagree(first: unknown, second: unknown): boolean {
  const firstGeometry = first && typeof first === "object" && !Array.isArray(first)
    ? first as Record<string, unknown>
    : {};
  const secondGeometry = second && typeof second === "object" && !Array.isArray(second)
    ? second as Record<string, unknown>
    : {};
  return ["rootScrollWidth", "bodyScrollWidth", "clientWidth"]
    .some((key) => !Object.is(firstGeometry[key], secondGeometry[key]));
}

function readFiniteMeasurement(value: Record<string, unknown>, key: string): number | null {
  const measurement = value[key];
  return typeof measurement === "number" && Number.isFinite(measurement) && measurement >= 0
    ? measurement
    : null;
}

function readVisualDiagnostics(value: unknown): {
  weakTypographyHierarchy: boolean;
  squareComponentTreatment: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { weakTypographyHierarchy: false, squareComponentTreatment: false };
  }
  const measurements = value as Record<string, unknown>;
  const h1FontPx = readFiniteMeasurement(measurements, "h1FontPx");
  const heroBodyFontPx = readFiniteMeasurement(measurements, "heroBodyFontPx");
  const componentCount = readFiniteMeasurement(measurements, "componentCount");
  const roundedComponentCount = readFiniteMeasurement(measurements, "roundedComponentCount");

  const weakTypographyHierarchy = h1FontPx !== null && (
    h1FontPx < 24
    || (heroBodyFontPx !== null && heroBodyFontPx < 12)
    || (heroBodyFontPx !== null && heroBodyFontPx > 0 && h1FontPx / heroBodyFontPx < 1.5)
  );
  const squareComponentTreatment = componentCount !== null
    && roundedComponentCount !== null
    && componentCount >= 3
    && roundedComponentCount / componentCount < 0.25;

  return { weakTypographyHierarchy, squareComponentTreatment };
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

async function captureWithPage(
  page: PageLike,
  html: string,
  internals: VisualQualityRendererInternals,
): Promise<VisualQualityViewports | null> {
  await page.setViewport(VISUAL_QUALITY_DESKTOP_VIEWPORT);
  await page.setContent(injectDeterministicRenderReset(html), { waitUntil: "load", timeout: 20_000 });

  const images: InlineImage[] = [];
  let mobileOverflow = false;
  let weakTypographyHierarchy = false;
  let squareComponentTreatment = false;
  for (const viewport of [VISUAL_QUALITY_DESKTOP_VIEWPORT, VISUAL_QUALITY_MOBILE_VIEWPORT]) {
    if (viewport !== VISUAL_QUALITY_DESKTOP_VIEWPORT) await page.setViewport(viewport);
    await awaitDeterministicLayout(page);
    await (internals.settle ?? (() => new Promise((resolve) => setTimeout(resolve, 400))))();
    if (viewport === VISUAL_QUALITY_MOBILE_VIEWPORT) {
      const readGeometry = () => page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          const h1 = document.querySelector("h1");
          let h1FontPx: number | null = null;
          if (h1 instanceof HTMLElement) {
            const style = window.getComputedStyle(h1);
            const rect = h1.getBoundingClientRect();
            const value = Number.parseFloat(style.fontSize);
            if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.isFinite(value) && value >= 0) {
              h1FontPx = value;
            }
          }
          const heroBody = document.querySelector("[data-openlen-role='hero'] p, main p, body p");
          let heroBodyFontPx: number | null = null;
          if (heroBody instanceof HTMLElement) {
            const style = window.getComputedStyle(heroBody);
            const rect = heroBody.getBoundingClientRect();
            const value = Number.parseFloat(style.fontSize);
            if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.isFinite(value) && value >= 0) {
              heroBodyFontPx = value;
            }
          }
          let componentCount = 0;
          let roundedComponentCount = 0;
          for (const component of document.querySelectorAll("button,[role='button'],article")) {
            if (!(component instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(component);
            const rect = component.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
            componentCount += 1;
            if (Math.max(
              Number.parseFloat(style.borderTopLeftRadius) || 0,
              Number.parseFloat(style.borderTopRightRadius) || 0,
              Number.parseFloat(style.borderBottomRightRadius) || 0,
              Number.parseFloat(style.borderBottomLeftRadius) || 0,
            ) >= 8) roundedComponentCount += 1;
          }
          return {
            rootScrollWidth: root.scrollWidth,
            bodyScrollWidth: body?.scrollWidth ?? 0,
            clientWidth: Math.max(window.innerWidth, root.clientWidth),
            h1FontPx,
            heroBodyFontPx,
            componentCount,
            roundedComponentCount,
          };
      });
      const firstGeometry = await readGeometry();
      const secondGeometry = await readGeometry();
      mobileOverflow = overflowGeometrySamplesDisagree(firstGeometry, secondGeometry)
        || hasDocumentHorizontalOverflow(firstGeometry)
        || hasDocumentHorizontalOverflow(secondGeometry);
      ({ weakTypographyHierarchy, squareComponentTreatment } = readVisualDiagnostics(firstGeometry));
    }
    const bytes = Buffer.from(await page.screenshot({ type: "jpeg", quality: 75, fullPage: false }));
    const image = { mimeType: "image/jpeg", dataBase64: bytes.toString("base64") };
    if (!isBoundedJpeg(image)) return null;
    images.push(image);
  }
  return {
    desktop: images[0]!,
    mobile: images[1]!,
    mobileOverflow,
    weakTypographyHierarchy,
    squareComponentTreatment,
  };
}

async function createBrowserWorker(internals: VisualQualityRendererInternals) {
  const browser = await (internals.launchBrowser ?? defaultLaunchBrowser)();
  try {
    const page = await browser.newPage();
    const guard = internals.installGuard ?? ((candidate: PageLike) =>
      installSubresourceSsrfGuard(candidate as Parameters<typeof installSubresourceSsrfGuard>[0]));
    await guard(page);
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function captureWithBrowser(
  html: string,
  internals: VisualQualityRendererInternals,
): Promise<VisualQualityViewports | null> {
  const worker = await createBrowserWorker(internals);
  try {
    return await captureWithPage(worker.page, html, internals);
  } finally {
    await worker.browser.close();
  }
}

export interface VisualQualityRendererPool {
  render(html: string): Promise<VisualQualityViewports | null>;
  close(): Promise<void>;
}

export interface VisualCandidateContactSheetFragment {
  candidateId: string;
  ordinal: number;
  role: string;
  html: string;
}

function escapeContactSheetLabel(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function contactSheetHtml(fragments: readonly VisualCandidateContactSheetFragment[]): string {
  const cells = fragments.map((fragment) => `<figure class="openlen-candidate">
    <figcaption>${fragment.ordinal} · ${escapeContactSheetLabel(fragment.role)} · ${escapeContactSheetLabel(fragment.candidateId)}</figcaption>
    <div class="openlen-candidate-fragment">${fragment.html}</div>
  </figure>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#111;color:#fff;font-family:Arial,sans-serif}
    .openlen-contact-sheet{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:234px;gap:8px;padding:8px;box-sizing:border-box}
    .openlen-candidate{position:relative;margin:0;overflow:hidden;border:1px solid #555;background:#fff;color:#111}
    .openlen-candidate figcaption{position:absolute;z-index:2147483647;top:0;left:0;right:0;padding:5px 7px;background:rgba(0,0,0,.86);color:#fff;font:700 11px/1.2 Arial,sans-serif}
    .openlen-candidate-fragment{position:absolute;inset:25px 0 0;overflow:hidden;transform-origin:top left}
  </style></head><body><main class="openlen-contact-sheet">${cells}</main></body></html>`;
}

/** Uses the calibrated renderer pool so browser reuse and deterministic settling stay unchanged. */
export async function renderVisualCandidateContactSheet(
  fragments: readonly VisualCandidateContactSheetFragment[],
  pool: VisualQualityRendererPool,
): Promise<InlineImage | null> {
  if (fragments.length > 12) return null;
  const ids = fragments.map((fragment) => fragment.candidateId);
  if (new Set(ids).size !== ids.length || fragments.some((fragment) =>
    !Number.isInteger(fragment.ordinal)
    || fragment.ordinal < 0
    || fragment.ordinal > 31
    || !fragment.candidateId
    || /<!doctype\b|<html\b|<head\b|<body\b/i.test(fragment.html))) return null;
  try {
    const rendered = await pool.render(contactSheetHtml(fragments));
    return rendered && isBoundedJpeg(rendered.desktop) ? rendered.desktop : null;
  } catch {
    return null;
  }
}

export async function createVisualQualityRendererPool(
  size: number,
  internals: VisualQualityRendererInternals = {},
): Promise<VisualQualityRendererPool> {
  if (!Number.isInteger(size) || size < 1 || size > 4) throw new Error("invalid_visual_renderer_pool_size");
  const workers: Awaited<ReturnType<typeof createBrowserWorker>>[] = [];
  try {
    for (let index = 0; index < size; index += 1) workers.push(await createBrowserWorker(internals));
  } catch (error) {
    await Promise.allSettled(workers.map((worker) => worker.browser.close()));
    throw error;
  }
  const tails: Promise<unknown>[] = workers.map(() => Promise.resolve());
  let cursor = 0;
  let closed = false;
  return {
    render(html) {
      if (closed) return Promise.resolve(null);
      const index = cursor % workers.length;
      cursor += 1;
      const task = tails[index].then(() => captureWithPage(workers[index].page, html, internals)).catch(() => null);
      tails[index] = task;
      return task;
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(tails);
      await Promise.allSettled(workers.map((worker) => worker.browser.close()));
    },
  };
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
