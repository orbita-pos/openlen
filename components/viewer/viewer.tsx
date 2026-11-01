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
import { useEffect, useState, type ReactNode } from "react";

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

  let body: ReactNode;
  if (kind === "download") body = <Offer file={file} actions={actions} />;
  else if (source === null) body = <Offer file={file} actions={actions} note={labels.noPreview} />;
  else if (loaded.state === "loading") body = <p className="viewer-note">{labels.loading}</p>;
  else if (loaded.state === "failed") body = <Offer file={file} actions={actions} note={labels.failed} />;
  else if (loaded.state === "frame") body = <iframe className="viewer-frame" title={file.name} src={loaded.src} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />;
  else if (loaded.state === "text") body = <pre className="viewer-text">{loaded.text}</pre>;
  else if (kind === "image")
    body = (
      // eslint-disable-next-line @next/next/no-img-element -- a blob URL of a private file, shown as it is
      <img className="viewer-image" src={loaded.url} alt={file.description ?? file.name} />
    );
  else if (kind === "video") body = <video className="viewer-video" src={loaded.url} controls playsInline />;
  else body = <PdfPages blob={loaded.blob} pageLabel={labels.page} />;

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
      <div className="viewer-body">{body}</div>
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
