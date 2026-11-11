"use client";

// THE ASSISTANT'S FIGURE, ALIVE (spec local 2026-11-10-figuras-del-asistente, §5.2–5.3): where she is the
// protagonist — the creator, her place's header, her tab on the phone. The flat figure is drawn at once and stays
// under the canvas until the engine paints its first frame; it comes back if the engine is not there (no WebGL2, the
// context lost, the switch off). At most one of these per screen: browsers ration WebGL contexts.
import { useEffect, useRef, useState } from "react";

import type { Figure, FigureActivity } from "@/lib/figure/engine";
import type { FigureLook } from "@/lib/figure/look";

import { AssistantFigure } from "./figure";

let asked: Promise<boolean> | null = null;
/** OPENLEN_FIGURES, asked once per page load. Not knowing is "off": the flat figure is never wrong. */
export function figuresOn(): Promise<boolean> {
  asked ??= fetch("/api/figures")
    .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: unknown }>) : { enabled: false }))
    .then((b) => b.enabled === true)
    .catch(() => false);
  return asked;
}
/** For the tests: the next figure asks again. */
export function forgetFiguresAnswer(): void {
  asked = null;
}

export function LiveFigure({
  look,
  size,
  activity = "ready",
  active = true,
  label,
  ask = figuresOn,
}: {
  look: FigureLook;
  size: number;
  activity?: FigureActivity;
  /** false pauses it: something covers it, or another figure is the live one now. */
  active?: boolean;
  label?: string;
  /** Whether the live figures are on. The phone asks through its own client. */
  ask?: () => Promise<boolean>;
}) {
  /** Where her canvas goes. The canvas itself is made by each run of the effect, below. */
  const stage = useRef<HTMLSpanElement | null>(null);
  const figure = useRef<Figure | null>(null);
  const [alive, setAlive] = useState(false);
  // What the figure is born with; later changes go through its setters, below.
  const born = useRef({ look, activity, active, size });
  born.current = { look, activity, active, size };

  useEffect(() => {
    let gone = false;
    const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    // A canvas of its own for this run. The engine gives a destroyed figure's context back to the browser, and this
    // figure is born after an await: on the last run's canvas it would find no context and stay flat for good (seen
    // on 11/11 after a refresh of the code; a host that changes `ask` would see the same).
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = born.current.size;
    canvas.height = born.current.size;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    stage.current?.append(canvas);
    const follow = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      if (box && box.width > 0) figure.current?.lookAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    };
    const motion = () => figure.current?.setReducedMotion(reduced?.matches === true);
    // `ask` is the host's: whatever it does — throw, answer nothing — the flat figure is already there.
    void Promise.resolve()
      .then(ask)
      .then((on) => (on === true && !gone ? import("@/lib/figure/engine") : null))
      .then((engine) => {
        if (!engine || gone || !canvas.isConnected) return;
        const made = engine.createFigure(canvas, born.current.look, {
          activity: born.current.activity,
          reducedMotion: reduced?.matches === true,
          onFirstFrame: () => !gone && setAlive(true),
          onLost: () => {
            figure.current = null;
            if (!gone) setAlive(false);
          },
        });
        if (!made) return;
        figure.current = made;
        made.setActive(born.current.active);
        addEventListener("pointermove", follow, { passive: true });
        reduced?.addEventListener?.("change", motion);
      })
      // The engine never breaks its host: whatever went wrong, the flat figure is already there.
      .catch(() => {});
    return () => {
      gone = true;
      // The next run starts from the flat figure, on its own canvas.
      setAlive(false);
      canvas.remove();
      removeEventListener("pointermove", follow);
      reduced?.removeEventListener?.("change", motion);
      figure.current?.destroy();
      figure.current = null;
    };
  }, [ask]);

  useEffect(() => figure.current?.setLook(look), [look]);
  useEffect(() => figure.current?.setActivity(activity), [activity]);
  useEffect(() => figure.current?.setActive(active), [active]);

  return (
    // Her name is on the wrapper: the flat figure is hidden once she is alive, and a hidden element says nothing.
    <span data-figure={alive ? "live" : "flat"} data-figure-active={String(active)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ position: "relative", display: "inline-flex", width: size, height: size, flex: "none" }}>
      <span style={{ visibility: alive ? "hidden" : "visible", display: "inline-flex" }}>
        <AssistantFigure look={look} size={size} />
      </span>
      <span ref={stage} style={{ position: "absolute", inset: 0, visibility: alive ? "visible" : "hidden", pointerEvents: "none" }} />
    </span>
  );
}
