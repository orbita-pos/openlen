"use client";
/**
 * THE VIEWER OF WHAT LEN DELIVERS (spec local 2026-10-31-len-movil, §5.1): one component for the web
 * workspace and the phone app, full screen, dark, like a phone's photo viewer. It has no strings and no
 * fetching of its own: the host passes its labels, how to fetch bytes (the web with its cookie, the phone
 * with its key in a header, which an <img src> can't carry) and how to open an HTML (on the canvas host,
 * never here). Plain CSS (`viewer.css`): the phone has no Tailwind and no workspace tokens.
 *
 * Office files show their PDF preview (made by LibreOffice when Len delivered them); without one, the
 * viewer says so and offers the actions, never a half-drawn document.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { PdfPages } from "./pdf-pages";
import { viewKindOf } from "./view-kind";

export interface ViewerFile {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly description?: string;
  readonly preview?: string;
  readonly projectTitle?: string;
}

export interface ViewerLabels {
  readonly close: string;
  readonly download: string;
  readonly noPreview: string;
  readonly loading: string;
  readonly failed: string;
  readonly page: (n: number, total: number) => string;
}

type Loaded = { readonly state: "loading" } | { readonly state: "failed" } | { readonly state: "blob"; readonly blob: Blob; readonly url: string } | { readonly state: "text"; readonly text: string } | { readonly state: "frame"; readonly src: string };

const TEXT_LIMIT = 1024 * 1024;

/** Images and PDFs zoom in the viewer itself: the phone's WebView has its own zoom off (Capacitor). */
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z));
type Point = { readonly clientX: number; readonly clientY: number };
const spread = (t: ArrayLike<Point>) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

/** A blob's text with FileReader, which every WebView has (`Blob.text()` is newer). */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

export function Viewer({
  file,
  loadBytes,
  openHtml,
  actions,
  labels,
  onClose,
}: {
  file: ViewerFile;
  loadBytes: (url: string) => Promise<Blob>;
  openHtml: (url: string) => Promise<string>;
  actions: ReactNode;
  labels: ViewerLabels;
  onClose: () => void;
}) {
  const kind = viewKindOf(file.name);
  const source = kind === "office" ? (file.preview ?? null) : file.url;
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    const settle = (next: Loaded) => {
      if (alive) setLoaded(next);
    };
    if (kind === "download" || source === null) return;
    if (kind === "html") {
      openHtml(file.url).then((src) => settle({ state: "frame", src }), () => settle({ state: "failed" }));
    } else {
      loadBytes(source).then(
        async (blob) => {
          if (kind === "text") return settle({ state: "text", text: await readText(blob.slice(0, TEXT_LIMIT)) });
          objectUrl = URL.createObjectURL(blob);
          if (!alive) return URL.revokeObjectURL(objectUrl);
          settle({ state: "blob", blob, url: objectUrl });
        },
        () => settle({ state: "failed" }),
      );
    }
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, source, file.url, loadBytes, openHtml]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  // The point under the fingers (or the double tap) stays where it was.
  const anchor = useRef<{ x: number; y: number; from: number } | null>(null);
  const zoomTo = (next: number, x: number, y: number) => {
    anchor.current = { x, y, from: zoomRef.current };
    setZoom(next);
  };
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a || a.from === zoom) return;
    const r = el.getBoundingClientRect();
    const k = zoom / a.from;
    el.scrollLeft = (el.scrollLeft + a.x - r.left) * k - (a.x - r.left);
    el.scrollTop = (el.scrollTop + a.y - r.top) * k - (a.y - r.top);
  }, [zoom]);

  let body: ReactNode;
  let zoomable = false;
  if (kind === "download") body = <Offer file={file} actions={actions} />;
  else if (source === null) body = <Offer file={file} actions={actions} note={labels.noPreview} />;
  else if (loaded.state === "loading") body = <p className="viewer-note">{labels.loading}</p>;
  else if (loaded.state === "failed") body = <Offer file={file} actions={actions} note={labels.failed} />;
  else if (loaded.state === "frame") body = <iframe className="viewer-frame" title={file.name} src={loaded.src} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />;
  else if (loaded.state === "text") body = <pre className="viewer-text">{loaded.text}</pre>;
  else if (kind === "image") {
    zoomable = true;
    body = (
      // eslint-disable-next-line @next/next/no-img-element -- a blob URL of a private file, shown as it is
      <img className="viewer-image" src={loaded.url} alt={file.description ?? file.name} />
    );
  }
  else if (kind === "video") body = <video className="viewer-video" src={loaded.url} controls playsInline />;
  else {
    zoomable = true;
    body = <PdfPages blob={loaded.blob} pageLabel={labels.page} />;
  }
  if (zoomable)
    body = (
      <div className={kind === "image" ? "viewer-zoom viewer-zoom-image" : "viewer-zoom"} data-zoomed={zoom > 1 ? "" : undefined} style={{ width: `${Math.round(zoom * 100)}%` }}>
        {body}
      </div>
    );

  // Two fingers: not passive, so the pinch never scrolls the page under it.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !zoomable) return;
    let pinch: { spread: number; zoom: number } | null = null;
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { spread: spread(e.touches) || 1, zoom: zoomRef.current };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      zoomTo(clampZoom((pinch.zoom * spread(e.touches)) / pinch.spread), (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2, (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2);
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [zoomable]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={file.name}>
      <header className="viewer-bar">
        <button type="button" className="viewer-close" data-viewer-close="" aria-label={labels.close} onClick={onClose}>
          ×
        </button>
        <div className="viewer-title">
          <b>{file.name}</b>
          {file.projectTitle && <small>{file.projectTitle}</small>}
        </div>
        <div className="viewer-actions">{actions}</div>
      </header>
      <div
        ref={bodyRef}
        className="viewer-body"
        onDoubleClick={zoomable ? (e) => zoomTo(zoomRef.current > 1 ? 1 : DOUBLE_TAP_ZOOM, e.clientX, e.clientY) : undefined}
      >
        {body}
      </div>
    </div>
  );
}

function Offer({ file, actions, note }: { file: ViewerFile; actions: ReactNode; note?: string }) {
  const kb = file.size / 1024;
  const size = kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
  return (
    <div className="viewer-offer">
      {note && <p className="viewer-note">{note}</p>}
      <b>{file.name}</b>
      <small>{size}</small>
      <div className="viewer-offer-actions">{actions}</div>
    </div>
  );
}
