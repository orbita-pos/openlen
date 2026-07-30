// Mini-preview of a curated template for the workspace picker.
//
// Two render paths:
//   * `imageUrl` set (the common case) → a lightweight static <img> facade
//     (the pre-rendered tile/thumbnail). No iframe, no Babel, no per-card
//     document load — this is what keeps a gallery of dozens of cards smooth.
//   * `imageUrl` null (template has no tile/thumbnail yet) → fall back to the
//     original live <iframe> of the template HTML, IntersectionObserver-gated
//     so we don't boot N compilers when the panel opens.
//
// Engineering notes (iframe fallback path):
//   * Native iframe is sized 1280×800 so the page renders at desktop
//     breakpoints, then CSS-transformed down to the card width.
//   * `pointer-events: none` on the iframe means clicks bubble up to the
//     card-level click handler.
//   * `sandbox="allow-scripts allow-same-origin"`: Babel-standalone fetches
//     sibling `<script type="text/babel" src>` via XHR; without same-origin
//     those fail CORS. The template HTML is curated content we ship.
//
//     Revisado en la auditoría de aislamiento (2026-07-29) y SE QUEDA, pero no
//     por el motivo de arriba: hoy ninguna de las 178 plantillas del catálogo
//     usa Babel, fetch/XHR ni type=module, así que esa justificación no está
//     ejercida por nada. Se queda porque quitarlo NO COMPRA NADA — medido en
//     navegador sobre las 3 fuentes que este componente pinta, todas con esta
//     misma bandera puesta:
//       · plantilla en R2 (prod)   → otro host: ya no alcanza cookies ni DOM
//       · self-host /template-objects → cubierto por la CSP de next.config
//       · /api/sections/<id>/preview  → cubierto por la CSP de esa ruta
//     Un header CSP `sandbox` gana sobre este atributo (se intersectan hacia
//     lo más restrictivo), así que el aislamiento ya está y quitar la bandera
//     solo agregaría riesgo para una plantilla futura que sí necesite mismo
//     origen — el registro acepta scripts inline a propósito (89% del corpus
//     los trae), o sea que ese camino existe.
//
//     Si algún día se quita: verificar que ninguna fuente quede sin CSP.
//     Nadie lee su contentDocument ni le hace postMessage (0 ocurrencias),
//     así que por ese lado no ata nada. Sonda: scratch/template-frame-decision.mts
//   * The chrome strip (3 traffic-light dots + a faint URL pill) is decorative.

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface TemplatePreviewFrameProps {
  /** URL served from storage — the iframe src (fallback path). */
  url: string;
  /** Display label used in aria-label + the chrome strip's URL pill. */
  name: string;
  /** Pre-rendered preview image (right-sized tile, else thumbnail). When set,
   *  the card renders a lightweight static <img> facade instead of booting a
   *  live iframe. Null → fall back to the iframe. */
  imageUrl?: string | null;
  /** True when this template is the currently-applied one — adds an accent
   *  ring + checkmark overlay. */
  applied?: boolean;
  /** Native viewport the inner page renders at. Wider = more horizontal
   *  density visible in the thumbnail; narrower = closer to mobile-cropped. */
  nativeWidth?: number;
  nativeHeight?: number;
}

export function TemplatePreviewFrame({
  url,
  name,
  imageUrl,
  applied = false,
  nativeWidth = 1280,
  nativeHeight = 800,
}: TemplatePreviewFrameProps) {
  const t = useTranslations("wsChrome");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  // Use the static image unless it failed to load. On error we fall back to
  // the live iframe so a dead tile/thumbnail URL never leaves a blank tile
  // under a forever-spinning shimmer.
  const useImage = Boolean(imageUrl) && !imgFailed;

  // Cached-image race: if the tile is already in HTTP cache the <img> can
  // finish loading before React attaches onLoad → `loaded` stays false →
  // permanent shimmer. Re-check `complete` after mount.
  useEffect(() => {
    if (!useImage) return;
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, [useImage]);

  // Lazy-mount the iframe only on the fallback path. Don't boot it until the
  // card is near viewport; once mounted we never unmount on scroll.
  useEffect(() => {
    if (useImage) return; // img facade — no iframe to gate
    if (!wrapperRef.current || mounted) return;
    const el = wrapperRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, useImage]);

  // Track rendered card width → transform scale (iframe path only).
  useEffect(() => {
    if (useImage) return;
    if (!stageRef.current) return;
    const el = stageRef.current;
    const compute = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / nativeWidth);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nativeWidth, useImage]);

  // The stage holds the scaled iframe; its height shrinks with the scale.
  const stageHeight = nativeHeight * scale;

  const shimmer = (
    <div
      aria-hidden
      className={`absolute inset-0 ${
        loaded ? "opacity-0" : "opacity-100"
      } transition-opacity duration-500 ease-out`}
      style={{
        background:
          "linear-gradient(110deg, color-mix(in oklch, var(--surface) 100%, transparent) 8%, color-mix(in oklch, var(--surface-elev) 100%, transparent) 18%, color-mix(in oklch, var(--surface) 100%, transparent) 33%)",
        backgroundSize: "200% 100%",
        animation: loaded ? "none" : "tplShimmer 1.6s ease-in-out infinite",
      }}
    />
  );

  return (
    <div
      ref={wrapperRef}
      className="relative overflow-hidden rounded-md ring-1 transition-colors"
      style={{
        boxShadow: applied
          ? "inset 0 0 0 1.5px var(--accent)"
          : "inset 0 0 0 1px color-mix(in oklch, var(--border) 100%, transparent)",
      }}
      aria-label={t("templatePreview.ariaLabel", { name })}
    >
      {/* Browser chrome strip — decorative cue that this is a webpage. */}
      <div
        className="relative z-10 flex items-center gap-1.5 h-[18px] px-2 border-b"
        style={{
          background: "color-mix(in oklch, var(--surface) 60%, transparent)",
          borderColor: "color-mix(in oklch, var(--border) 80%, transparent)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      >
        <span
          className="w-[7px] h-[7px] rounded-full"
          style={{ background: "#FF5F57" }}
          aria-hidden
        />
        <span
          className="w-[7px] h-[7px] rounded-full"
          style={{ background: "#FEBC2E" }}
          aria-hidden
        />
        <span
          className="w-[7px] h-[7px] rounded-full"
          style={{ background: "#28C840" }}
          aria-hidden
        />
        <span
          className="ml-1.5 truncate text-[9px] tracking-tight fg-faint"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {name.toLowerCase()}.openlen.com
        </span>
        {applied && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[8.5px] uppercase tracking-[0.16em] text-accent font-semibold">
            <span
              className="inline-block w-[6px] h-[6px] rounded-full"
              style={{ background: "var(--accent)" }}
              aria-hidden
            />
            {t("templatePreview.applied")}
          </span>
        )}
      </div>

      {useImage ? (
        // Static image facade — the fast path. Aspect-ratio box reserves the
        // height (no CLS); lazy + async-decode keep a wall of cards smooth.
        <div
          className="relative bg-app"
          style={{ aspectRatio: `${nativeWidth} / ${nativeHeight}` }}
        >
          {shimmer}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl ?? ""}
            alt={t("templatePreview.iframeTitle", { name })}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setImgFailed(true)}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              opacity: loaded ? 1 : 0,
              transition: "opacity 380ms cubic-bezier(.2,.7,.2,1)",
            }}
          />
        </div>
      ) : (
        // Live iframe fallback — only when no tile/thumbnail exists yet.
        <div
          ref={stageRef}
          className="relative bg-app"
          style={{ height: stageHeight > 0 ? stageHeight : nativeHeight * 0.21 }}
        >
          {shimmer}
          {mounted && scale > 0 && (
            <iframe
              src={url}
              title={t("templatePreview.iframeTitle", { name })}
              sandbox="allow-scripts allow-same-origin"
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              style={{
                width: nativeWidth,
                height: nativeHeight,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                border: 0,
                pointerEvents: "none",
                opacity: loaded ? 1 : 0,
                transition: "opacity 380ms cubic-bezier(.2,.7,.2,1)",
                willChange: "transform",
              }}
            />
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes tplShimmer {
          0% {
            background-position: 100% 0;
          }
          100% {
            background-position: -100% 0;
          }
        }
      `}</style>
    </div>
  );
}
