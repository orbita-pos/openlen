"use client";
/**
 * A PDF drawn page by page with pdf.js (spec local 2026-10-31-len-movil, §5.1): the delivered PDF itself
 * or an Office file's preview. Pages are drawn as they scroll into view, at the container's width and
 * the screen's pixel density. pdf.js is loaded only when a PDF is opened; its worker by a URL that both
 * webpack 5 (the web) and Vite (the phone) resolve.
 */
import { useEffect, useRef, useState } from "react";

type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas: HTMLCanvasElement }): { promise: Promise<unknown>; cancel(): void };
};
/** What `getDocument()` returns. In pdf.js 6 only this task has `destroy()`, not the document it opens. */
type PdfLoading = { promise: Promise<PdfDocument>; destroy(): Promise<void> };

async function openPdf(blob: Blob): Promise<PdfLoading> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }) as unknown as PdfLoading;
}

export function PdfPages({ blob, pageLabel }: { blob: Blob; pageLabel: (n: number, total: number) => string }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let loading: PdfLoading | null = null;
    openPdf(blob)
      .then((task) => {
        loading = task;
        if (!alive) return void task.destroy();
        return task.promise.then((d) => alive && setDoc(d));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      void loading?.destroy();
    };
  }, [blob]);
  if (failed) return <p className="viewer-note">PDF</p>;
  if (!doc) return null;
  return (
    <div className="viewer-pdf">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPageCanvas key={i} doc={doc} n={i + 1} label={pageLabel(i + 1, doc.numPages)} />
      ))}
    </div>
  );
}

/** One page's canvas at most: ~32 MB, under what a phone's WebView will hold for one canvas. */
export const MAX_PAGE_PIXELS = 8_000_000;
/** A width change under this ratio keeps the page as drawn. */
const REDRAW_RATIO = 1.15;
/** Pinching resizes the page every frame; it is drawn again once the fingers rest. */
const SETTLE_MS = 200;

function PdfPageCanvas({ doc, n, label }: { doc: PdfDocument; n: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // A page is drawn when it nears the screen, at the width it is shown; zooming draws it again at the new
  // width (sharp, not the first drawing stretched), and a zoomed page that scrolls away goes back to the
  // screen's width, so only the pages in view hold big canvases.
  useEffect(() => {
    const el = canvas.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    let alive = true;
    let visible = typeof IntersectionObserver === "undefined";
    let drawnWidth = 0;
    let seq = 0;
    let rendering: { cancel(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = async (cssWidth: number) => {
      const mine = ++seq;
      rendering?.cancel();
      drawnWidth = cssWidth;
      const page = await doc.getPage(n);
      if (!alive || mine !== seq) return;
      const base = page.getViewport({ scale: 1 });
      let scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_PAGE_PIXELS) scale *= Math.sqrt(MAX_PAGE_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      // Drawn aside and copied in at once: resizing the visible canvas would blank it while pdf.js draws.
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      const context = off.getContext("2d");
      if (!context) return;
      const task = page.render({ canvasContext: context, viewport, canvas: off });
      rendering = task;
      try {
        await task.promise;
      } catch {
        return; // cancelled by a newer drawing
      }
      if (!alive || mine !== seq) return;
      el.width = off.width;
      el.height = off.height;
      el.getContext("2d")?.drawImage(off, 0, 0);
      off.width = off.height = 0;
    };
    const fit = () => {
      const shown = box.clientWidth || 800;
      if (!visible && drawnWidth === 0) return;
      const want = visible ? shown : Math.min(shown, window.innerWidth || shown);
      if (drawnWidth && want <= drawnWidth * REDRAW_RATIO && want * REDRAW_RATIO >= drawnWidth) return;
      if (!visible && want >= drawnWidth) return;
      void draw(want);
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(fit, SETTLE_MS);
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    resize?.observe(box);
    const seen =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            if (visible && drawnWidth === 0) fit();
            else later();
          }, { rootMargin: "400px" });
    seen?.observe(el);
    if (visible) fit();
    return () => {
      alive = false;
      clearTimeout(timer);
      rendering?.cancel();
      resize?.disconnect();
      seen?.disconnect();
    };
  }, [doc, n]);
  return (
    <figure className="viewer-page">
      <canvas ref={canvas} aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
