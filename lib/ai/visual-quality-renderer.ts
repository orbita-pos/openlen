import type { InlineImage } from "@/lib/ai-gateway";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

export const VISUAL_QUALITY_DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;
export const VISUAL_QUALITY_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const MAX_VIEWPORT_BYTES = 1024 * 1024;
// These captures cross the same inline-image boundary as generated assets,
// which refuses anything over 4096px on an axis. A full-page mobile capture of
// a real landing page is several times that, so the critic was never shown a
// page at all — the request died before leaving the process.
const MAX_CAPTURE_HEIGHT = 4096;
const DETERMINISTIC_RENDER_RESET = "<style data-openlen-deterministic-render-reset>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}}</style>";

/** Un texto que el navegador pintó, medido contra el fondo que de verdad lo
 *  pinta. `probe` es el `data-ol-probe` del elemento cuando el documento venía
 *  marcado, y -1 cuando no: sin él la lectura sirve de señal pero no se puede
 *  reparar. */
export interface UnreadableTextFinding {
  readonly probe: number;
  readonly background: string;
  readonly contrast: number;
}

export interface VisualQualityViewports {
  desktop: InlineImage;
  mobile: InlineImage;
  mobileOverflow?: boolean;
  weakTypographyHierarchy?: boolean;
  squareComponentTreatment?: boolean;
  invalidGeometry?: boolean;
  unreadableText?: readonly UnreadableTextFinding[];
}

interface PageLike {
  setViewport(viewport: { width: number; height: number }): Promise<unknown>;
  setContent(html: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  evaluate(pageFunction: () => unknown): Promise<unknown>;
  screenshot(options: {
    type: "jpeg";
    quality: number;
    captureBeyondViewport: boolean;
    clip: { x: number; y: number; width: number; height: number };
  }): Promise<Uint8Array>;
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

/** Returns the settled document height, or null when it cannot be measured —
 * the capture is bounded either way. */
async function awaitDeterministicLayout(page: PageLike): Promise<number | null> {
  const height = await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
  });
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : null;
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

function hasValidDocumentGeometry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  const measurements = [geometry.rootScrollWidth, geometry.bodyScrollWidth, geometry.clientWidth];
  return measurements.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
    && Number(geometry.clientWidth) > 0;
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

function readUnreadableText(value: unknown): UnreadableTextFinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const findings = (value as Record<string, unknown>).unreadableText;
  if (!Array.isArray(findings)) return [];
  const out: UnreadableTextFinding[] = [];
  for (const entry of findings) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const probe = typeof row.probe === "number" && Number.isInteger(row.probe) ? row.probe : -1;
    const background = typeof row.background === "string" && /^#[0-9a-f]{6}$/i.test(row.background) ? row.background : null;
    const contrast = typeof row.contrast === "number" && Number.isFinite(row.contrast) ? row.contrast : null;
    if (background === null || contrast === null) continue;
    out.push({ probe, background, contrast });
  }
  return out.slice(0, 12);
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
  let invalidGeometry = false;
  let unreadableText: UnreadableTextFinding[] = [];
  for (const viewport of [VISUAL_QUALITY_DESKTOP_VIEWPORT, VISUAL_QUALITY_MOBILE_VIEWPORT]) {
    if (viewport !== VISUAL_QUALITY_DESKTOP_VIEWPORT) await page.setViewport(viewport);
    const documentHeight = await awaitDeterministicLayout(page);
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
          // Texto que el navegador pintó pero nadie puede leer. Se mide aquí
          // porque sólo el render sabe qué hay DETRÁS de cada texto: el mismo
          // `color:#f6efe2` sin fondo propio es correcto sobre la foto oscura
          // del hero e invisible sobre la banda crema de al lado, y ningún
          // análisis del CSS distingue los dos casos.
          // Sin funciones auxiliares, a propósito: el empaquetador les pone
          // nombre con `__name(...)` y ese ayudante no existe en el navegador,
          // así que una sola `const parseColor = …` aquí dentro tumba la
          // medición entera con `__name is not defined`. Las devoluciones de
          // llamada anónimas sí sobreviven.
          const RGB_RE = /^rgba?\(([^)]+)\)/i;
          const SEPARATOR_RE = /[\s,/]+/;
          const WEIGHTS = [0.2126, 0.7152, 0.0722];
          const unreadableText: { probe: number; background: string; contrast: number }[] = [];
          const seen = new Set<string>();
          const TEXT_TAGS = "h1,h2,h3,h4,h5,h6,p,a,span,li,button,strong,em,label,td,th,dt,dd,blockquote,figcaption,div";
          for (const node of body ? body.querySelectorAll(TEXT_TAGS) : []) {
            if (unreadableText.length >= 12) break;
            if (!(node instanceof HTMLElement)) continue;
            // Sólo elementos que llevan texto PROPIO: el padre de un texto
            // anidado hereda un color que no es el que se pinta.
            let owns = false;
            for (const child of node.childNodes) {
              if (child.nodeType === 3 && (child.textContent ?? "").trim().length > 1) { owns = true; break; }
            }
            if (!owns) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const style = window.getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") continue;
            if ((Number.parseFloat(style.opacity) || 0) < 0.5) continue;
            if ((Number.parseFloat(style.fontSize) || 0) < 6) continue;

            // El primer fondo OPACO hacia arriba es el que de verdad lo pinta.
            // Una imagen o un velo translúcido en el camino significa que no
            // sabemos qué hay debajo, y una duda jamás debe convertirse en un
            // hallazgo. Nada opaco hasta la raíz es el lienzo blanco.
            let backgroundText = "rgb(255, 255, 255)";
            let uncertain = false;
            for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
              const ancestorStyle = window.getComputedStyle(ancestor);
              if (ancestorStyle.backgroundImage && ancestorStyle.backgroundImage !== "none") { uncertain = true; break; }
              const painted = (RGB_RE.exec(ancestorStyle.backgroundColor) ?? ["", ""])[1]
                .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
              if (painted.length < 3) continue;
              const alpha = painted.length > 3 && Number.isFinite(painted[3]) ? painted[3] : 1;
              if (alpha <= 0.02) continue;
              if (alpha < 0.95) { uncertain = true; break; }
              backgroundText = ancestorStyle.backgroundColor;
              break;
            }
            if (uncertain) continue;

            const luminances: number[] = [];
            for (const value of [style.color, backgroundText]) {
              const channels = (RGB_RE.exec(value) ?? ["", ""])[1]
                .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
              if (channels.length < 3 || channels.slice(0, 3).some((channel) => !Number.isFinite(channel))) break;
              // Un texto translúcido se lee sobre lo que tenga debajo; medirlo
              // como si fuera opaco es inventar un hallazgo.
              if (channels.length > 3 && Number.isFinite(channels[3]) && channels[3] < 0.9) break;
              let total = 0;
              for (let index = 0; index < 3; index += 1) {
                const scaled = Math.min(255, Math.max(0, channels[index])) / 255;
                total += WEIGHTS[index] * (scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4));
              }
              luminances.push(total);
            }
            if (luminances.length !== 2) continue;
            const contrast = (Math.max(luminances[0], luminances[1]) + 0.05) / (Math.min(luminances[0], luminances[1]) + 0.05);
            // 2:1 es deliberadamente bajo. No mide accesibilidad: separa
            // "cuesta leerlo" de "no está".
            if (contrast >= 2) continue;

            const channels = (RGB_RE.exec(backgroundText) ?? ["", ""])[1]
              .split(SEPARATOR_RE).filter((piece) => piece.length > 0).map(Number);
            let background = "#";
            for (let index = 0; index < 3; index += 1) {
              background += Math.min(255, Math.max(0, Math.round(channels[index]))).toString(16).padStart(2, "0");
            }
            const raw = node.getAttribute("data-ol-probe");
            const probeValue = raw === null ? -1 : Number(raw);
            const probe = Number.isInteger(probeValue) && probeValue >= 0 ? probeValue : -1;
            const key = `${probe}|${background}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unreadableText.push({ probe, background, contrast: Math.round(contrast * 100) / 100 });
          }

          return {
            rootScrollWidth: root.scrollWidth,
            bodyScrollWidth: body?.scrollWidth ?? 0,
            clientWidth: Math.max(window.innerWidth, root.clientWidth),
            h1FontPx,
            heroBodyFontPx,
            componentCount,
            roundedComponentCount,
            unreadableText,
          };
      });
      const firstGeometry = await readGeometry();
      const secondGeometry = await readGeometry();
      invalidGeometry = !hasValidDocumentGeometry(firstGeometry) || !hasValidDocumentGeometry(secondGeometry);
      mobileOverflow = overflowGeometrySamplesDisagree(firstGeometry, secondGeometry)
        || hasDocumentHorizontalOverflow(firstGeometry)
        || hasDocumentHorizontalOverflow(secondGeometry);
      ({ weakTypographyHierarchy, squareComponentTreatment } = readVisualDiagnostics(firstGeometry));
      unreadableText = readUnreadableText(firstGeometry);
    }
    const bytes = Buffer.from(await page.screenshot({
      type: "jpeg",
      quality: 75,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(documentHeight ?? MAX_CAPTURE_HEIGHT, MAX_CAPTURE_HEIGHT) },
    }));
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
    invalidGeometry,
    unreadableText,
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

function escapeContactSheetSrcdoc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function contactSheetHtml(fragments: readonly VisualCandidateContactSheetFragment[]): string {
  const cells = fragments.map((fragment) => `<figure class="openlen-candidate">
    <figcaption>${fragment.ordinal} · ${escapeContactSheetLabel(fragment.role)} · ${escapeContactSheetLabel(fragment.candidateId)}</figcaption>
    <iframe sandbox="" title="Candidate ${fragment.ordinal}" srcdoc="${escapeContactSheetSrcdoc(fragment.html)}"></iframe>
  </figure>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#111;color:#fff;font-family:Arial,sans-serif}
    .openlen-contact-sheet{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:234px;gap:8px;padding:8px;box-sizing:border-box}
    .openlen-candidate{position:relative;margin:0;overflow:hidden;border:1px solid #555;background:#fff;color:#111}
    .openlen-candidate figcaption{position:absolute;z-index:2147483647;top:0;left:0;right:0;padding:5px 7px;background:rgba(0,0,0,.86);color:#fff;font:700 11px/1.2 Arial,sans-serif}
    .openlen-candidate iframe{position:absolute;inset:25px 0 0;width:100%;height:calc(100% - 25px);border:0;background:#fff}
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
  } catch (error) {
    if (process.env.OPENLEN_RENDER_DEBUG === "1") console.error(error);
    return null;
  }
}
