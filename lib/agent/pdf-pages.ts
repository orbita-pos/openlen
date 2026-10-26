/**
 * A PDF's PAGES AS IMAGES (26/10), for `Read` on a PDF the user attached — the
 * way Claude Code's Read hands PDF pages to the model (its `pdftoppm` path:
 * one image per page, at most 20 per call, a long PDF only by range).
 *
 * Not poppler, as Claude Code: it runs on the user's own machine with their
 * own files, and here the PDF comes from anyone into a shared server. pdf.js
 * (Firefox's viewer) draws it inside the eyes' Chromium (`lanzarChromium`:
 * Chrome's sandbox, the filtering proxy) on an origin that doesn't exist:
 * every request is answered from memory — pdf.js, its worker, its fonts and
 * the PDF — and anything else is aborted, so nothing reaches the network.
 * JavaScript inside the PDF never runs (pdf.js doesn't run it outside its
 * viewer) and `isEvalSupported` is off.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "puppeteer";

import type { InlineImage } from "@/lib/ai-gateway";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { PDF_PAGES_WITHOUT_RANGE } from "@/lib/projects/chat-files";

/** Width of each page image, in pixels: legible text at about 1,000–1,500 image tokens. */
export const PDF_PAGE_WIDTH = 1000;
/** A very tall page is drawn smaller rather than as a huge image. */
const MAX_PAGE_HEIGHT = 3000;
const RENDER_TIMEOUT_MS = 60_000;

const ORIGIN = "https://pdf.openlen.invalid";
const PDFJS = path.join(process.cwd(), "node_modules", "pdfjs-dist");

export type PdfPages =
  | { readonly ok: true; readonly pageCount: number; readonly first: number; readonly last: number; readonly images: InlineImage[] }
  | { readonly ok: false; readonly reason: "too_many_pages" | "page_out_of_range"; readonly pageCount: number }
  | { readonly ok: false; readonly reason: "password_protected" | "corrupted" };

export interface PdfPagesInternals {
  readonly lanzar?: () => Promise<Browser>;
  /** For tests that share one browser: leave it open. */
  readonly keepBrowser?: boolean;
}

/** What the fake origin serves: pdf.js, its worker, fonts and cmaps, and the PDF. */
async function answer(pathname: string, pdf: Uint8Array): Promise<{ contentType: string; body: Buffer | string } | null> {
  if (pathname === "/") return { contentType: "text/html", body: "<!doctype html><title>pdf</title>" };
  if (pathname === "/doc.pdf") return { contentType: "application/pdf", body: Buffer.from(pdf) };
  if (pathname === "/pdf.min.mjs" || pathname === "/pdf.worker.min.mjs") {
    return { contentType: "text/javascript", body: await readFile(path.join(PDFJS, "build", pathname.slice(1))) };
  }
  const m = /^\/(cmaps|standard_fonts)\/([A-Za-z0-9_.-]+)$/.exec(pathname);
  if (m) return { contentType: "application/octet-stream", body: await readFile(path.join(PDFJS, m[1]!, m[2]!)).catch(() => Buffer.alloc(0)) };
  return null;
}

/** The script run in the page: open, count, check the range, draw. A string,
 *  so the bundler never sees its `import()`. */
const DRAW = (range: { first: number; last: number } | null) => `(async () => {
  const pdfjs = await import("/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  let task, doc;
  try {
    task = pdfjs.getDocument({
      url: "/doc.pdf", cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/",
      disableRange: true, disableStream: true, isEvalSupported: false,
    });
    doc = await task.promise;
  } catch (e) {
    return { error: e && e.name === "PasswordException" ? "password_protected" : "corrupted" };
  }
  const pageCount = doc.numPages;
  if (pageCount < 1) return { error: "corrupted" };
  const range = ${JSON.stringify(range)};
  if (!range && pageCount > ${PDF_PAGES_WITHOUT_RANGE}) return { error: "too_many_pages", pageCount };
  const first = range ? range.first : 1;
  if (first > pageCount) return { error: "page_out_of_range", pageCount };
  const last = Math.min(range ? range.last : pageCount, pageCount);
  const images = [];
  for (let n = first; n <= last; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(${PDF_PAGE_WIDTH} / base.width, ${MAX_PAGE_HEIGHT} / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    page.cleanup();
  }
  await task.destroy();
  return { pageCount, first, last, images };
})()`;

/**
 * The pages of `pdf` as JPEG images, one per page: all of them for a PDF of up
 * to 10 pages, or `range` (1-based, inclusive, already at most 20 long),
 * cut at the last page. Throws only if there is no browser.
 */
export async function renderPdfPages(pdf: Uint8Array, range: { first: number; last: number } | null, internals: PdfPagesInternals = {}): Promise<PdfPages> {
  const browser = await (internals.lanzar ?? lanzarChromium)();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      void (async () => {
        try {
          const u = new URL(req.url());
          const r = u.origin === ORIGIN ? await answer(u.pathname, pdf) : null;
          if (r) await req.respond({ status: 200, contentType: r.contentType, body: r.body });
          else await req.abort("blockedbyclient");
        } catch {
          await req.abort("blockedbyclient").catch(() => undefined);
        }
      })();
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: "load", timeout: 20_000 });
    const drawn = (await Promise.race([
      page.evaluate(DRAW(range)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("the PDF took too long to draw")), RENDER_TIMEOUT_MS)),
    ])) as { error?: string; pageCount?: number; first?: number; last?: number; images?: string[] };
    if (drawn.error === "too_many_pages" || drawn.error === "page_out_of_range") return { ok: false, reason: drawn.error, pageCount: drawn.pageCount! };
    if (drawn.error === "password_protected") return { ok: false, reason: "password_protected" };
    if (drawn.error) return { ok: false, reason: "corrupted" };
    return {
      ok: true,
      pageCount: drawn.pageCount!,
      first: drawn.first!,
      last: drawn.last!,
      images: drawn.images!.map((dataBase64) => ({ mimeType: "image/jpeg", dataBase64 })),
    };
  } finally {
    await page.close().catch(() => undefined);
    if (!internals.keepBrowser) await browser.close().catch(() => undefined);
  }
}
