// Live mini-preview of a curated template. Renders the actual /public/templates
// HTML inside an iframe scaled down to thumbnail size — the user sees the real
// Tide / Folio / Daybreak page (terminal mockups, sparklines, hand-drawn
// chips, the lot) instead of an abstract wireframe stripe.
//
// Engineering notes:
//   * Native iframe is sized 1280×800 so the page's responsive layout renders
//     at desktop breakpoints, then CSS-transformed down to the card width.
//   * IntersectionObserver gates mounting so we don't boot 9 Babel-standalone
//     compilers when the panel opens. Cards far below the fold stay as
//     skeleton until they scroll near viewport.
//   * `pointer-events: none` on the iframe means clicks bubble up to the
//     card-level click handler — no fighting with the iframe for focus.
//   * `sandbox="allow-scripts allow-same-origin"`: Babel-standalone fetches
//     the `<script type="text/babel" src="...">` siblings via XHR. Without
//     `allow-same-origin` the iframe takes an opaque origin and those same-
//     host XHRs fail CORS. We accept the same-origin escape hatch because
//     the template HTML is fully curated content we ship ourselves; the
//     iframe also has `pointer-events: none` and never receives user input.
//   * The chrome strip at top (3 traffic-light dots + a faint URL pill) is
//     purely decorative — it telegraphs "this is a webpage" so users don't
//     mistake the preview for static art.

"use client";

import { useEffect, useRef, useState } from "react";

export interface TemplatePreviewFrameProps {
  /** URL served from /public/templates/ — includes the hash that picks the
   *  variant inside the shell (e.g. "/templates/technical-minimal#tide"). */
  url: string;
  /** Display label used in aria-label + the chrome strip's URL pill. */
  name: string;
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
  applied = false,
  nativeWidth = 1280,
  nativeHeight = 800,
}: TemplatePreviewFrameProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0);

  // Lazy-mount: don't boot the iframe until the card is near viewport.
  // Once mounted we never unmount on scroll — re-booting Babel for every
  // scroll-in would be cruel.
  useEffect(() => {
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
  }, [mounted]);

  // Track the rendered card width so we can compute the transform scale.
  // ResizeObserver fires once on mount, then whenever the sidebar resizes.
  useEffect(() => {
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
  }, [nativeWidth]);

  // The stage holds the scaled iframe; its height shrinks with the scale.
  const stageHeight = nativeHeight * scale;

  return (
    <div
      ref={wrapperRef}
      className="relative overflow-hidden rounded-md ring-1 transition-colors"
      style={{
        // Hairline border that lifts on hover via the parent card's :hover.
        // Color comes from CSS vars so it lands correctly in light + dark.
        boxShadow: applied
          ? "inset 0 0 0 1.5px var(--accent)"
          : "inset 0 0 0 1px color-mix(in oklch, var(--border) 100%, transparent)",
      }}
      aria-label={`Live preview of ${name}`}
    >
      {/* Browser chrome strip — purely decorative cue that this is a webpage. */}
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
            Applied
          </span>
        )}
      </div>

      {/* Scaled iframe stage. We render at `nativeWidth × nativeHeight` and
          transform-scale down to fit the card width. */}
      <div
        ref={stageRef}
        className="relative bg-app"
        style={{ height: stageHeight > 0 ? stageHeight : nativeHeight * 0.21 }}
      >
        {/* Skeleton shimmer: visible until iframe load fires. Held behind
            the iframe with a lower stacking context so it fades nicely. */}
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

        {mounted && scale > 0 && (
          <iframe
            src={url}
            title={`${name} live preview`}
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

      {/* Local keyframes — scoped here so the panel doesn't need to ship
          another global style. */}
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
