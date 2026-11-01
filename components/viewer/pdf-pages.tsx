"use client";
/**
 * A PDF drawn page by page with pdf.js (spec local 2026-10-31-len-movil, §5.1): the delivered PDF itself
 * or an Office file's preview. Pages are drawn as they scroll into view, at the container's width and
 * the screen's pixel density. pdf.js is loaded only when a PDF is opened; its worker by a URL that both
 * webpack 5 (the web) and Vite (the phone) resolve.
 */
import { useEffect, useRef, useState } from "react";

type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas: HTMLCanvasElement }): { promise: Promise<void> };
};

async function openPdf(blob: Blob): Promise<PdfDocument> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return (await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise) as unknown as PdfDocument;
}

export function PdfPages({ blob, pageLabel }: { blob: Blob; pageLabel: (n: number, total: number) => string }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let opened: PdfDocument | null = null;
    openPdf(blob).then(
      (d) => {
        opened = d;
        if (alive) setDoc(d);
        else void d.destroy();
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      void opened?.destroy();
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

function PdfPageCanvas({ doc, n, label }: { doc: PdfDocument; n: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el || drawn) return;
    const draw = async () => {
      setDrawn(true);
      const page = await doc.getPage(n);
      const width = el.parentElement?.clientWidth || 800;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
      el.width = viewport.width;
      el.height = viewport.height;
      const context = el.getContext("2d");
      if (context) await page.render({ canvasContext: context, viewport, canvas: el }).promise;
    };
    if (typeof IntersectionObserver === "undefined") return void draw();
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        void draw();
      }
    }, { rootMargin: "400px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [doc, n, drawn]);
  return (
    <figure className="viewer-page">
      <canvas ref={canvas} aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
