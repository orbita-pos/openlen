"use client";

// THE LAYER BEHIND THE WORKSPACE (spec local 2026-11-27-temas-del-workspace, §4.3; Claude Code's desktop theme mods):
// the theme's scene as an `<img>` (it runs nothing: served with a CSP that allows none, and an image never runs script),
// fixed under everything; the workspace's surfaces turn to frosted glass over it; the theme's palette and font as custom
// properties of the workspace's root. A theme without a scene may still paint a still ground, never with glass.
//
// Mounted as the FIRST CHILD of `div.workspace-v2` (`app/[locale]/new/page.tsx`): it marks that root —
// `data-theme-layer`, `data-theme-glass`, `data-theme-font` and the custom properties on its `style` — and nothing else.
// The rules that read those marks live in `app/[locale]/new/tokens.css`: the glass is painted ONLY on the surfaces that
// carry `data-glass-surface` (the rail with Len's panel, the top bar, the start rail, their menus), its blur on a
// `::before` so no surface becomes the containing block of a `position: fixed` child. 🔴 The client's canvas never shows
// the scene: nothing touches `--bg-preview`, and under a theme the canvas paints an opaque base below its own colour
// (Review Focus 5).
//
// The window (Review Focus 1): if the theme has a twin for the person's own mode, the twin is painted and nothing is
// forced; otherwise `<html>.dark` is switched to the theme's window while it is on — the class ONLY, never
// `localStorage["inari:dark"]` — and given back when it goes.
//
// Motion (Review Focus 3): reduced motion or WebGL drawn by software start on the still scene; otherwise the frames are
// counted for two seconds after the scene decodes and a slow machine gets the still one (`motion-guard.ts`).
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { ResolvedTheme } from "@/lib/themes/resolve";
import { THEME_TOKENS, type ThemeFont, type ThemeGround, type ThemeWindow } from "@/lib/themes/types";

import { detectRenderer, measureFps, prefersReducedMotion, shouldStayStill } from "./motion-guard";
import { useWorkspaceTheme } from "./use-workspace-theme";

const DARK_KEY = "inari:dark";

/** One generic stack per font a theme may ask for (`ThemeFont`); `code` is the monospace one. */
export const FONT_STACKS: Readonly<Record<ThemeFont, string>> = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  code: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  cursive: "'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive",
};

/** The three backgrounds the glass owns: under glass, a palette's value for them is left to the glass. */
const GLASS_TOKENS = new Set<string>(["--bg", "--bg-sidebar", "--bg-elev"]);
const PALETTE_TOKENS = new Set<string>(THEME_TOKENS);

function readStoredDark(): boolean | null {
  try {
    const stored = window.localStorage.getItem(DARK_KEY);
    return stored === null ? null : stored === "1";
  } catch {
    return null;
  }
}

// ─── a still ground, as CSS ─────────────────────────────────────────────────

/** Attribute text for the ground's SVG. The values are already validated raw colours and path data; escaped anyway. */
const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function vectorSvg(ground: Extract<ThemeGround, { vector: unknown }>["vector"], window: ThemeWindow): string {
  const fallback = ground.color ?? (window === "dark" ? "#ffffff" : "#000000");
  const paths = ground.paths
    .map((p) => {
      const color = attr(p.color ?? fallback);
      return p.strokeWidth !== undefined && p.strokeWidth > 0
        ? `<path d="${attr(p.d)}" fill="none" stroke="${color}" stroke-width="${p.strokeWidth}"/>`
        : `<path d="${attr(p.d)}" fill="${color}" fill-rule="evenodd"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${attr(ground.viewBox)}" preserveAspectRatio="xMidYMid slice">${paths}</svg>`;
}

export function groundStyle(ground: ThemeGround, window: ThemeWindow): CSSProperties {
  if ("color" in ground) return { backgroundColor: ground.color };
  if ("gradient" in ground) {
    const g = ground.gradient;
    const stops = g.stops.map((s) => (s.at === undefined ? s.color : `${s.color} ${Math.round(s.at * 10000) / 100}%`)).join(", ");
    const image = g.shape === "radial" ? `radial-gradient(${stops})` : `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
    return {
      backgroundImage: image,
      backgroundSize: g.size ?? "100% 100%",
      backgroundRepeat: g.repeat ? "repeat" : "no-repeat",
    };
  }
  const v = ground.vector;
  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(vectorSvg(v, window))}")`,
    backgroundSize: v.size ?? "cover",
    backgroundRepeat: v.repeat ? "repeat" : "no-repeat",
    backgroundPosition: "center",
  };
}

const LAYER: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  zIndex: -1,
  pointerEvents: "none",
  userSelect: "none",
};

// ─── the component ──────────────────────────────────────────────────────────

export function ThemeBackdrop({ projectId }: { projectId: string | null }) {
  const anchor = useRef<HTMLDivElement>(null);
  const { resolved, twin } = useWorkspaceTheme(projectId);

  // The person's own mode: their saved setting, else what the pre-paint script put on <html> (read before any forcing).
  // Unknown until mounted, so the server and the first paint draw no layer.
  const forcing = useRef<{ prior: boolean } | null>(null);
  const [personDark, setPersonDark] = useState<boolean | null>(null);
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setPersonDark(readStoredDark() ?? (forcing.current ? forcing.current.prior : html.classList.contains("dark")));
    read();
    // The person may switch modes while a theme is on (the workspace's own toggle writes the class and the setting).
    const observer = new MutationObserver(read);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const personWindow: ThemeWindow | null = personDark === null ? null : personDark ? "dark" : "light";
  const chosen =
    personWindow === null || !resolved
      ? null
      : resolved.window !== personWindow && twin && twin.window === personWindow
        ? twin
        : resolved;
  const force = chosen && personWindow !== null && chosen.window !== personWindow ? chosen.window : null;

  // Forcing the theme's window: the class only. Given back to the person's setting (or the class it had) on the way out.
  useEffect(() => {
    if (!force) return;
    const html = document.documentElement;
    forcing.current = { prior: html.classList.contains("dark") };
    html.classList.toggle("dark", force === "dark");
    return () => {
      const prior = forcing.current?.prior ?? false;
      forcing.current = null;
      html.classList.toggle("dark", readStoredDark() ?? prior);
    };
  }, [force, personDark]);

  // The scene's source: the still one from the start with reduced motion or a software renderer.
  const [scene, setScene] = useState<{ ref: string; src: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const sceneUrl = chosen?.sceneUrl;
  const stillUrl = chosen?.stillUrl ?? chosen?.sceneUrl;
  const chosenRef = chosen?.ref ?? null;
  const heavy = chosen?.heavy ?? false;
  useEffect(() => {
    if (!chosenRef || !sceneUrl || !stillUrl) {
      setScene(null);
      return;
    }
    const startStill = shouldStayStill({ reducedMotion: prefersReducedMotion(), fps: null, renderer: detectRenderer(), heavy: false });
    setScene({ ref: chosenRef, src: startStill ? stillUrl : sceneUrl });
  }, [chosenRef, sceneUrl, stillUrl]);

  const img = useRef<HTMLImageElement>(null);
  const shown = scene && chosen && scene.ref === chosen.ref && failed !== scene.src ? scene : null;
  const moving = shown !== null && shown.src === sceneUrl && sceneUrl !== stillUrl;

  // The guard: two seconds of frames once the moving scene has decoded; a slow machine gets the still one.
  useEffect(() => {
    if (!moving || !stillUrl || !chosenRef) return;
    let cancelled = false;
    void (async () => {
      try {
        await img.current?.decode?.();
      } catch {
        // A scene that cannot decode is the error handler's; nothing to measure.
        return;
      }
      if (cancelled) return;
      const fps = await measureFps();
      if (cancelled) return;
      if (shouldStayStill({ reducedMotion: prefersReducedMotion(), fps, renderer: null, heavy })) {
        setScene((current) => (current && current.ref === chosenRef ? { ref: chosenRef, src: stillUrl } : current));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moving, stillUrl, chosenRef, heavy]);

  const ground = chosen && !chosen.sceneUrl ? chosen.ground : undefined;
  const glass = shown && chosen && chosen.glass !== false ? chosen.glass : null;
  const layer = shown !== null || ground !== undefined;

  // The marks on the workspace's root, and only there.
  const colors = chosen?.colors;
  const font = chosen?.font;
  useEffect(() => {
    const root = anchor.current?.closest<HTMLElement>(".workspace-v2");
    if (!root) return;
    const props: [string, string][] = [];
    const attrs: string[] = [];
    if (layer) attrs.push("data-theme-layer");
    if (glass) {
      attrs.push("data-theme-glass");
      // No tint: none is set, and the CSS falls back to the root's own --bg (never transparent).
      if (glass.tint) props.push(["--glass-tint", glass.tint]);
      props.push(["--glass-opacity", String(glass.opacity)], ["--glass-blur", `${glass.blur}px`]);
    }
    for (const [token, value] of Object.entries(colors ?? {})) {
      if (!PALETTE_TOKENS.has(token) || (glass && GLASS_TOKENS.has(token))) continue;
      props.push([token, value]);
    }
    if (font) {
      attrs.push("data-theme-font");
      props.push(["--theme-font", FONT_STACKS[font]]);
    }
    for (const a of attrs) root.setAttribute(a, "");
    for (const [name, value] of props) root.style.setProperty(name, value);
    return () => {
      for (const a of attrs) root.removeAttribute(a);
      for (const [name] of props) root.style.removeProperty(name);
    };
  }, [layer, glass, colors, font]);

  return (
    <div ref={anchor} data-theme-backdrop="" aria-hidden="true" style={{ display: "contents" }}>
      {shown && (
        <img
          ref={img}
          src={shown.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          onError={() => setFailed(shown.src)}
          style={{ ...LAYER, objectFit: "cover" }}
        />
      )}
      {ground && chosen && <div data-theme-ground="" style={{ ...LAYER, ...groundStyle(ground, chosen.window) }} />}
    </div>
  );
}
