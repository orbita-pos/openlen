"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "./icons";
import { PREVIEW_PRELUDE, preparePreviewSnapshot } from "./preview-prelude";
import { publishedHost, subdomainFromTitle } from "@/lib/publish/base-host";

// PageAssembling — the "watch your page being built" surface for the /new AI
// flow. A premium browser-chrome frame on a soft stage; inside, a live iframe
// shows the REAL page materialising:
//
//   • bespoke (streaming): the streamed document is written into the iframe
//     PROGRESSIVELY (native parser paints top→down, no reload flicker), and
//     the view auto-scrolls to follow the build. Because Gemini emits <head>
//     (Tailwind CDN + styles) first, sections arrive already styled.
//   • curation (snapshot): the chosen template is shown the instant the server
//     knows it (a `preview` event), then swapped to the filled version — a
//     full-doc write each time.
//
// The page is rendered at a fixed 1280px desktop width and scaled to fit the
// frame, so the real desktop design shows (not its mobile breakpoint).

const DESKTOP_W = 1280;

interface Props {
  /** Current best HTML to display (streamed-so-far, or a snapshot). */
  html?: string;
  /** True for the bespoke token-stream — progressive write + follow-scroll. */
  streaming?: boolean;
  /** Finished — close the doc, reveal from the top, show the ✓ state. */
  done?: boolean;
  /** Live stage text under the frame (e.g. "Writing your copy…"). */
  caption?: string;
  /** Lo que el navegador MIDIÓ sobre la página anterior, verbatim y sin
   *  traducir. Va debajo del rótulo: el rótulo dice qué está pasando y esto
   *  dice por qué. Traducir una medida es perderla — «Assignment to constant
   *  variable» se busca en un motor de búsqueda, «asignación a variable
   *  constante» no. Ausente casi siempre: sólo durante una reescritura. */
  medido?: string;
  /** Pre-first-byte "server saturated" reassurance. */
  slow?: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Fake URL bar host derived from the page's <title> (e.g. "acme.openlen.com"). */
function hostFromHtml(html: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html.slice(0, 4000));
  const slug = subdomainFromTitle(m?.[1] ?? "", 28);
  return publishedHost(slug || "tu-sitio");
}

export function PageAssembling({
  html = "",
  streaming = false,
  done = false,
  caption,
  medido,
  slow = false,
}: Props) {
  const t = useTranslations("wsPage");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const writtenRef = useRef("");
  const [scale, setScale] = useState(1);
  const [frameH, setFrameH] = useState(0);

  const host = useMemo(
    () => (html ? hostFromHtml(html) : publishedHost("tu-sitio")),
    [html],
  );

  // Fit the 1280px design into the frame, like the editor's fitScale.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const compute = () => {
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w <= 0 || h <= 0) return;
      const s = Math.min(1, w / DESKTOP_W);
      setScale(s);
      setFrameH(Math.ceil(h / s)); // iframe drawn tall, then scaled down to fit
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  // Write HTML into the iframe. Every doc.open() writes PREVIEW_PRELUDE first
  // — la CSP tiene que regir ANTES del primer byte del modelo (ver
  // preview-prelude.ts). `writtenRef` sigue midiendo SOLO el HTML del modelo,
  // así que la lógica de prefijo del streaming no cambia.
  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !html) return;
    try {
      if (streaming) {
        if (writtenRef.current && html.startsWith(writtenRef.current)) {
          doc.write(html.slice(writtenRef.current.length)); // append the new chunk
        } else {
          doc.open();
          doc.write(PREVIEW_PRELUDE);
          doc.write(html); // (re)start the stream
        }
        writtenRef.current = html;
        if (!prefersReducedMotion()) {
          iframe.contentWindow?.scrollTo(0, doc.documentElement.scrollHeight);
        }
      } else if (html !== writtenRef.current) {
        // Snapshot (curación): documento completo, así que el carrier de la
        // plantilla puede re-emitirse con nonce y conservar su paleta.
        const snap = preparePreviewSnapshot(html);
        doc.open();
        doc.write(snap.prelude);
        doc.write(snap.html);
        doc.close();
        writtenRef.current = html;
        iframe.contentWindow?.scrollTo(0, 0);
      }
    } catch {
      /* cross-frame timing race — the next chunk retries */
    }
  }, [html, streaming]);

  // Finish: close the streamed doc + glide back to the hero.
  useEffect(() => {
    if (!done) return;
    const iframe = iframeRef.current;
    try {
      iframe?.contentDocument?.close();
      iframe?.contentWindow?.scrollTo({
        top: 0,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    } catch {
      /* ignore */
    }
  }, [done]);

  // Close on unmount so a half-streamed doc doesn't keep "loading".
  useEffect(
    () => () => {
      try {
        iframeRef.current?.contentDocument?.close();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const showSkeleton = !html;

  // VER EL CÓDIGO ESCRIBIÉNDOSE.
  //
  // No es adorno: es el TESTIGO. Si ves a Len escribir el documento y la página
  // publicada no coincide, la mentira se ve al instante. Nadie podía notarlo
  // porque nadie veía nunca el código — y por eso se acumularon 33
  // transformaciones y 7 pasadas de normalizador sin que nadie protestara.
  //
  // Es exactamente el mismo `html` que alimenta el iframe de al lado: no hay
  // una segunda fuente que pueda decir otra cosa.
  const [verCodigo, setVerCodigo] = useState(false);
  const codigoRef = useRef<HTMLPreElement | null>(null);

  // Sigue al final mientras escribe, como una terminal. En cuanto termina se
  // suelta: el usuario querrá leer desde arriba.
  useEffect(() => {
    if (!verCodigo || done) return;
    const el = codigoRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [html, verCodigo, done]);

  return (
    <div className="pa-stage">
      <div className="pa-title">{t("aiStatus.assembling")}</div>
      <div className={`pa-window${done ? " pa-window-done" : ""}`}>
        <div className="pa-chrome">
          <span className="pa-dot" />
          <span className="pa-dot" />
          <span className="pa-dot" />
          <div className="pa-url">
            <svg className="pa-lock" viewBox="0 0 24 24" width="9" height="9" aria-hidden>
              <path
                fill="currentColor"
                d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 8H9V6a3 3 0 0 1 6 0v3Z"
              />
            </svg>
            <span className="pa-host">{host}</span>
          </div>
          <button
            type="button"
            className="pa-code-toggle"
            aria-pressed={verCodigo}
            onClick={() => setVerCodigo((v) => !v)}
            title={verCodigo ? t("aiStatus.seePage") : t("aiStatus.seeCode")}
          >
            {verCodigo ? t("aiStatus.seePage") : t("aiStatus.seeCode")}
          </button>
          <span className={`pa-spark${done ? " pa-spark-done" : ""}`} aria-hidden>
            {done ? <Check size={12} /> : null}
          </span>
        </div>
        {verCodigo && (
          <pre className="pa-code" ref={codigoRef}>
            <code>{html || ""}</code>
          </pre>
        )}
        <div className="pa-viewport" ref={viewportRef} hidden={verCodigo}>
          <iframe
            ref={iframeRef}
            title={t("aiStatus.assembling")}
            className="pa-iframe"
            // allow-same-origin es OBLIGATORIO: doc.write() sobre
            // contentDocument no existe sin él, y ese write ES el streaming
            // progresivo. Lo que de verdad frena la ejecución es la CSP del
            // prólogo; el sandbox suma lo que antes no había NINGUNO —
            // sin allow-top-navigation, popups, forms, modals ni descargas.
            sandbox="allow-scripts allow-same-origin"
            style={{
              width: DESKTOP_W,
              height: frameH || "100%",
              transform: `scale(${scale})`,
            }}
          />
          {showSkeleton && (
            <div className="pa-skel" aria-hidden>
              <div className="pa-skel-nav">
                <span className="pa-blk pa-logo" />
                <span className="pa-skel-spacer" />
                <span className="pa-blk pa-navlink" />
                <span className="pa-blk pa-navlink" />
                <span className="pa-blk pa-navlink" />
                <span className="pa-blk pa-navbtn" />
              </div>
              <div className="pa-skel-hero">
                <span className="pa-blk pa-h1" />
                <span className="pa-blk pa-h2" />
                <span className="pa-blk pa-sub" />
                <div className="pa-skel-cta">
                  <span className="pa-blk pa-btn" />
                  <span className="pa-blk pa-btn pa-btn-ghost" />
                </div>
              </div>
              <div className="pa-skel-cards">
                <span className="pa-blk pa-card" />
                <span className="pa-blk pa-card" />
                <span className="pa-blk pa-card" />
              </div>
            </div>
          )}
          {streaming && !done && <div className="pa-fade" aria-hidden />}
        </div>
      </div>
      <div className={`pa-caption${done ? " pa-caption-done" : ""}`} aria-live="polite">
        {done ? (
          <>
            <Check size={14} className="pa-check" />
            <span>{t("aiStatus.ready")}</span>
          </>
        ) : (
          <>
            <span className="pa-spin" />
            <span>{slow ? t("aiStatus.serverSaturated") : caption || t("aiStatus.assembling")}</span>
            {!slow && medido && <span className="pa-medido">{medido}</span>}
          </>
        )}
      </div>

      <style jsx global>{`
        .pa-stage {
          --pa-bg: #f5f5f4;
          --pa-glow: rgba(255, 90, 54, 0.10);
          --pa-win-bg: #ffffff;
          --pa-win-border: rgba(0, 0, 0, 0.08);
          --pa-win-shadow: 0 24px 70px rgba(0, 0, 0, 0.16);
          --pa-chrome-bg: #f1f0ef;
          --pa-chrome-border: rgba(0, 0, 0, 0.07);
          --pa-dot: rgba(0, 0, 0, 0.16);
          --pa-urlbar: #ffffff;
          --pa-url-fg: rgba(40, 24, 20, 0.55);
          --pa-title: rgba(40, 24, 20, 0.5);
          --pa-caption: rgba(40, 24, 20, 0.66);
          --pa-accent: #ff5a36;
          --pa-skel: rgba(0, 0, 0, 0.06);
          --pa-skel-hi: rgba(0, 0, 0, 0.13);

          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 22px 24px 18px;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 38%, var(--pa-glow), transparent 55%),
            var(--pa-bg);
        }
        :root.dark .pa-stage {
          --pa-bg: #0b0a0a;
          --pa-glow: rgba(255, 90, 54, 0.12);
          --pa-win-bg: #100c0b;
          --pa-win-border: rgba(255, 255, 255, 0.08);
          --pa-win-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
          --pa-chrome-bg: #181312;
          --pa-chrome-border: rgba(255, 255, 255, 0.06);
          --pa-dot: rgba(255, 255, 255, 0.16);
          --pa-urlbar: #0c0908;
          --pa-url-fg: rgba(255, 224, 214, 0.55);
          --pa-title: rgba(255, 234, 226, 0.5);
          --pa-caption: rgba(255, 234, 226, 0.66);
          --pa-skel: rgba(255, 255, 255, 0.06);
          --pa-skel-hi: rgba(255, 255, 255, 0.13);
        }
        .pa-title {
          flex-shrink: 0;
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: var(--pa-title);
        }
        .pa-window {
          width: 100%;
          max-width: 1040px;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          border-radius: 14px;
          overflow: hidden;
          background: var(--pa-win-bg);
          border: 1px solid var(--pa-win-border);
          box-shadow: var(--pa-win-shadow);
          transition: box-shadow 0.5s ease, transform 0.5s ease;
        }
        .pa-window-done {
          box-shadow:
            0 0 0 1px rgba(255, 90, 54, 0.3),
            var(--pa-win-shadow);
        }
        .pa-chrome {
          flex-shrink: 0;
          height: 38px;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 0 14px;
          background: var(--pa-chrome-bg);
          border-bottom: 1px solid var(--pa-chrome-border);
        }
        .pa-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--pa-dot);
        }
        .pa-url {
          flex: 1;
          margin: 0 8px;
          height: 23px;
          max-width: 340px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          border-radius: 999px;
          background: var(--pa-urlbar);
          color: var(--pa-url-fg);
          font: 500 11px/1 ui-sans-serif, system-ui, sans-serif;
          box-shadow: inset 0 0 0 1px var(--pa-chrome-border);
        }
        .pa-lock {
          flex-shrink: 0;
          opacity: 0.7;
        }
        .pa-host {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pa-spark {
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          color: #fff;
          background: var(--pa-accent);
          opacity: 0;
          transform: scale(0.6);
          transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .pa-spark-done {
          opacity: 1;
          transform: scale(1);
        }
        /* El interruptor vive en la barra del navegador falso, donde el
           usuario ya está mirando. Discreto: es una opción, no una alarma. */
        .pa-code-toggle {
          margin-left: auto;
          margin-right: 8px;
          border: 0;
          background: transparent;
          color: var(--pa-url-fg, #8a8f98);
          font-size: 10.5px;
          letter-spacing: 0.02em;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 5px;
          transition: color 0.15s ease, background 0.15s ease;
        }
        .pa-code-toggle:hover,
        .pa-code-toggle[aria-pressed='true'] {
          color: var(--pa-win-fg, #e6e6e6);
          background: rgba(127, 127, 127, 0.14);
        }
        /* Ocupa el mismo hueco que el viewport, para que cambiar de vista no
           mueva la ventana ni un píxel. */
        .pa-code {
          position: relative;
          flex: 1;
          min-height: 0;
          overflow: auto;
          margin: 0;
          padding: 14px 16px;
          background: var(--pa-win-bg);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11.5px;
          line-height: 1.65;
          color: var(--pa-win-fg, #d8dbe0);
          white-space: pre-wrap;
          word-break: break-word;
          tab-size: 2;
        }

        .pa-viewport {
          position: relative;
          flex: 1;
          min-height: 0;
          overflow: hidden;
          background: var(--pa-win-bg);
        }
        .pa-iframe {
          border: 0;
          display: block;
          transform-origin: top left;
          background: var(--pa-win-bg);
        }
        .pa-fade {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 22%;
          pointer-events: none;
          background: linear-gradient(
            to bottom,
            transparent,
            color-mix(in srgb, var(--pa-win-bg) 88%, transparent)
          );
        }
        .pa-skel {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          gap: 7%;
          padding: 6% 8%;
          background: var(--pa-win-bg);
        }
        .pa-skel-nav {
          display: flex;
          align-items: center;
          gap: 14px;
          animation: pa-rise 0.5s ease both;
          animation-delay: 0.04s;
        }
        .pa-skel-spacer {
          flex: 1;
        }
        .pa-skel-hero {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 15px;
          animation: pa-rise 0.5s ease both;
          animation-delay: 0.16s;
        }
        .pa-skel-cta {
          display: flex;
          gap: 12px;
          margin-top: 6px;
        }
        .pa-skel-cards {
          display: flex;
          gap: 16px;
          animation: pa-rise 0.5s ease both;
          animation-delay: 0.3s;
        }
        .pa-blk {
          flex-shrink: 0;
          border-radius: 7px;
          background-color: var(--pa-skel);
          background-image: linear-gradient(
            90deg,
            transparent,
            var(--pa-skel-hi),
            transparent
          );
          background-size: 220% 100%;
          background-repeat: no-repeat;
          animation: pa-shimmer 1.5s linear infinite;
        }
        .pa-logo {
          width: 92px;
          height: 18px;
        }
        .pa-navlink {
          width: 46px;
          height: 9px;
        }
        .pa-navbtn {
          width: 92px;
          height: 28px;
          border-radius: 999px;
          background-color: color-mix(in srgb, var(--pa-accent) 20%, var(--pa-skel));
        }
        .pa-h1 {
          width: 60%;
          height: 30px;
        }
        .pa-h2 {
          width: 44%;
          height: 30px;
        }
        .pa-sub {
          width: 52%;
          height: 13px;
          margin-top: 4px;
        }
        .pa-btn {
          width: 124px;
          height: 34px;
          border-radius: 999px;
          background-color: color-mix(in srgb, var(--pa-accent) 30%, var(--pa-skel));
        }
        .pa-btn-ghost {
          width: 104px;
          background-color: var(--pa-skel);
        }
        .pa-card {
          flex: 1;
          height: 120px;
          border-radius: 12px;
        }
        .pa-caption {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          line-height: 1.4;
          color: var(--pa-caption);
        }
        /* La medida, debajo del rótulo: se lee si te interesa y no grita si
           no. Se parte por palabras porque un mensaje del navegador puede ser
           larguísimo y no puede empujar el lienzo a lo ancho. */
        .pa-medido {
          display: block;
          width: 100%;
          margin-top: 4px;
          font-size: 11px;
          line-height: 1.45;
          opacity: 0.72;
          overflow-wrap: break-word;
        }
        .pa-caption-done {
          color: var(--pa-accent);
          font-weight: 500;
        }
        .pa-check {
          color: var(--pa-accent);
        }
        .pa-spin {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          border: 2px solid var(--pa-accent);
          border-top-color: transparent;
          animation: pa-spin 0.7s linear infinite;
        }
        @keyframes pa-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes pa-shimmer {
          0% {
            background-position: -120% 0;
          }
          100% {
            background-position: 220% 0;
          }
        }
        @keyframes pa-rise {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pa-spin {
            animation: none;
          }
          .pa-blk {
            animation: none;
          }
          .pa-skel-nav,
          .pa-skel-hero,
          .pa-skel-cards {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
