"use client";

// Rayo X — overlay visual del escaneo (spec 2026-07-09-rayo-x-scan-design §6,
// constantes verbatim del demo aprobado). Vive como HERMANO POSTERIOR del
// iframe dentro del contenedor relative de preview-area. GOTCHA (cazado en el
// demo): el filter del busy crea stacking contexts — este overlay lleva
// z-index explícito o el iframe se pinta ENCIMA del escaneo; por lo mismo el
// filter va en el <iframe>, nunca en el wrapper que nos contiene.

import { useEffect, useRef, useState } from "react";
import {
  scanController,
  type ScanController,
  type ScanState,
} from "@/lib/workspace-v2/scan-controller";

const CSS = `
.olscan-root{position:absolute;inset:0;pointer-events:none;z-index:30;overflow:hidden;border-radius:inherit;--olscan-sweep:800px}
.olscan-block{position:absolute;inset:0;pointer-events:auto;cursor:progress}
.olscan-vignette{position:absolute;inset:0;opacity:0;transition:opacity .4s;
  background:radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(24,14,8,.20) 100%)}
.olscan-root.scanning .olscan-vignette{opacity:1}
.olscan-corner{position:absolute;width:16px;height:16px;opacity:0;transition:opacity .4s .1s;
  border:1.5px solid color-mix(in srgb, var(--accent) 65%, transparent)}
.olscan-c1{top:10px;left:10px;border-right:0;border-bottom:0}
.olscan-c2{top:10px;right:10px;border-left:0;border-bottom:0}
.olscan-c3{bottom:10px;left:10px;border-right:0;border-top:0}
.olscan-c4{bottom:10px;right:10px;border-left:0;border-top:0}
.olscan-root.scanning .olscan-corner{opacity:1}
.olscan-win{position:absolute;left:0;right:0;top:-210px;height:210px;
  -webkit-mask-image:linear-gradient(to bottom,transparent,black 34%,black 72%,transparent);
  mask-image:linear-gradient(to bottom,transparent,black 34%,black 72%,transparent)}
.olscan-grid{position:absolute;left:0;right:0;top:0;height:calc(210px + var(--olscan-sweep));
  background:
    repeating-linear-gradient(to right, color-mix(in srgb, var(--accent) 16%, transparent) 0 1px, transparent 1px 28px),
    repeating-linear-gradient(to bottom, color-mix(in srgb, var(--accent) 16%, transparent) 0 1px, transparent 1px 28px)}
.olscan-line{position:absolute;left:0;right:0;height:34px;top:-227px;opacity:0;
  -webkit-mask-image:linear-gradient(to right,transparent,black 7%,black 93%,transparent);
  mask-image:linear-gradient(to right,transparent,black 7%,black 93%,transparent)}
.olscan-line::before{content:"";position:absolute;left:0;right:0;top:50%;height:1.5px;
  background:#fff;box-shadow:0 0 9px 1.5px color-mix(in srgb, var(--accent) 90%, #fff 10%)}
.olscan-line::after{content:"";position:absolute;inset:0;
  background:linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 22%, transparent) 45%,
    color-mix(in srgb, var(--accent) 30%, transparent) 52%, transparent)}
.olscan-root.loop .olscan-win{animation:olscan-travel 1.6s cubic-bezier(.45,.05,.55,.95) infinite}
.olscan-root.loop .olscan-grid{animation:olscan-counter 1.6s cubic-bezier(.45,.05,.55,.95) infinite}
.olscan-root.loop .olscan-line{opacity:1;animation:olscan-travel 1.6s cubic-bezier(.45,.05,.55,.95) infinite}
.olscan-root.final .olscan-win{animation:olscan-travel 1.6s cubic-bezier(.45,.05,.55,.95) forwards}
.olscan-root.final .olscan-grid{animation:olscan-counter 1.6s cubic-bezier(.45,.05,.55,.95) forwards}
.olscan-root.final .olscan-line{opacity:1;animation:olscan-travel 1.6s cubic-bezier(.45,.05,.55,.95) forwards}
@keyframes olscan-travel{0%{transform:translateY(0)}100%{transform:translateY(calc(var(--olscan-sweep) + 220px))}}
@keyframes olscan-counter{0%{transform:translateY(0)}100%{transform:translateY(calc(-1 * (var(--olscan-sweep) + 220px)))}}
.olscan-ring{position:absolute;inset:0;border-radius:inherit;opacity:0;
  transition:opacity .5s cubic-bezier(.2,.7,.3,1);
  box-shadow:inset 0 0 0 1.5px var(--accent), inset 0 0 46px color-mix(in srgb, var(--accent) 14%, transparent)}
.olscan-ring.on{opacity:1}
@media (prefers-reduced-motion: reduce){
  .olscan-root.loop .olscan-win,.olscan-root.loop .olscan-grid,.olscan-root.loop .olscan-line,
  .olscan-root.final .olscan-win,.olscan-root.final .olscan-grid,.olscan-root.final .olscan-line{animation:none}
  .olscan-line{opacity:0}
  .olscan-root.scanning .olscan-vignette{opacity:.7}
}
`;

export function ScanOverlay({
  controller = scanController,
  onBusyChange,
}: {
  controller?: ScanController;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [state, setState] = useState<ScanState>(controller.getState());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const winRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    if (state.busy !== busyRef.current) {
      busyRef.current = state.busy;
      onBusyChange?.(state.busy);
    }
  }, [state.busy, onBusyChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof ResizeObserver === "undefined") return;
    const measure = () =>
      root.style.setProperty("--olscan-sweep", `${root.offsetHeight}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const active = state.phase === "scanning" || state.phase === "finalizing";

  // React's onAnimationIteration is unreliable in jsdom (see scan-overlay.test.tsx
  // test 5) — a native listener behaves identically in real browsers and is
  // observable via dispatchEvent in tests. `active` is a dep (not just
  // `controller`) because .olscan-win only exists in the DOM while active —
  // the ref isn't populated yet on the render where this effect first runs.
  useEffect(() => {
    const win = winRef.current;
    if (!win) return;
    const onIter = () => controller.onIteration();
    win.addEventListener("animationiteration", onIter);
    return () => win.removeEventListener("animationiteration", onIter);
  }, [controller, active]);

  const cls = [
    "olscan-root",
    active && !state.ring ? "scanning" : "",
    state.phase === "scanning" ? "loop" : "",
    state.phase === "finalizing" ? "final" : "",
  ].join(" ").trim();

  return (
    <div ref={rootRef} className={cls} aria-hidden="true">
      <style>{CSS}</style>
      {state.busy && <div className="olscan-block" />}
      <div className="olscan-vignette" />
      <div className="olscan-corner olscan-c1" /><div className="olscan-corner olscan-c2" />
      <div className="olscan-corner olscan-c3" /><div className="olscan-corner olscan-c4" />
      {active && (
        <>
          <div ref={winRef} className="olscan-win">
            <div className="olscan-grid" />
          </div>
          <div className="olscan-line" />
        </>
      )}
      <div className={`olscan-ring${state.ring ? " on" : ""}`} />
    </div>
  );
}
