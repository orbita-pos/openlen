// @vitest-environment jsdom
//
// The layer behind the workspace (spec local 2026-11-27-temas-del-workspace, §4.3): the scene as an `<img>` that runs
// nothing, glass over it, the theme's window forced without touching the person's own setting (Review Focus 1), the
// palette and the font as custom properties, a still ground with no glass, the motion guard (Review Focus 3), a theme
// that is gone painting nothing (Review Focus 2), and the client's canvas never seeing any of it (Review Focus 5).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import type { ResolvedTheme } from "@/lib/themes/resolve";
import { THEME_TOKENS } from "@/lib/themes/types";

const guard = vi.hoisted(() => ({ fps: 60 as number | null, renderer: null as string | null, measured: 0 }));
vi.mock("./motion-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./motion-guard")>()),
  measureFps: async () => {
    guard.measured += 1;
    return guard.fps;
  },
  detectRenderer: () => guard.renderer,
}));

import { ThemeBackdrop } from "./theme-backdrop";
import { reloadWorkspaceThemes, previewWorkspaceTheme } from "./use-workspace-theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LAGOON: ResolvedTheme = {
  ref: "bundled:honu-lagoon",
  window: "light",
  sceneUrl: "/api/themes/scene?ref=bundled%3Ahonu-lagoon",
  stillUrl: "/api/themes/scene?ref=bundled%3Ahonu-lagoon&still=1",
  glass: { blur: 7, opacity: 0.42, tint: "#e6fbff" },
  heavy: false,
  title: "Honu lagoon",
};
const DAWN: ResolvedTheme = {
  ref: "bundled:halftone-dawn",
  window: "light",
  twinRef: "bundled:halftone-dusk",
  sceneUrl: "/api/themes/scene?ref=bundled%3Ahalftone-dawn",
  stillUrl: "/api/themes/scene?ref=bundled%3Ahalftone-dawn&still=1",
  glass: { blur: 14, opacity: 0.55, tint: "#f6ead9" },
  heavy: false,
  title: "Halftone dawn",
};
const DUSK: ResolvedTheme = {
  ref: "bundled:halftone-dusk",
  window: "dark",
  twinRef: "bundled:halftone-dawn",
  sceneUrl: "/api/themes/scene?ref=bundled%3Ahalftone-dusk",
  stillUrl: "/api/themes/scene?ref=bundled%3Ahalftone-dusk&still=1",
  glass: { blur: 14, opacity: 0.5, tint: "#1f2336" },
  heavy: false,
  title: "Halftone dusk",
};
const REEF: ResolvedTheme = { ...LAGOON, ref: "bundled:night-reef", window: "dark", sceneUrl: "/s?ref=reef", stillUrl: "/s?ref=reef&still=1", glass: { blur: 16, opacity: 0.6, tint: "#0b1a2a" }, title: "Night reef" };

type Answer = { status: number; body?: unknown };
let answer: Answer;
let previewAnswer: ResolvedTheme | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
const state = (resolved: ResolvedTheme | null, twin: ResolvedTheme | null = null): Answer => ({
  status: 200,
  body: { applied: { project: null, everywhere: resolved?.ref ?? null }, resolved, twin, available: [] },
});

let reducedMotion = false;
/** What the system prefers (`prefers-color-scheme: dark`): with nothing saved, that is the person's mode. */
let systemDark = false;
const roots: Root[] = [];
let host: HTMLDivElement;

beforeEach(() => {
  answer = state(null);
  previewAnswer = null;
  guard.fps = 60;
  guard.renderer = null;
  guard.measured = 0;
  reducedMotion = false;
  systemDark = false;
  window.localStorage.clear();
  document.documentElement.className = "";
  fetchMock = vi.fn(async (url: string) => {
    const preview = new URL(url, "http://localhost").searchParams.get("preview");
    const body = preview !== null && answer.status === 200
      ? { ...(answer.body as object), previewed: previewAnswer ? { resolved: previewAnswer, twin: null } : null }
      : answer.body;
    return new Response(JSON.stringify(body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : query.includes("prefers-color-scheme: dark") ? systemDark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  act(() => previewWorkspaceTheme(null));
});

/** The workspace's root as `app/[locale]/new/page.tsx` draws it, with the canvas of `preview-area.tsx` inside. */
async function mount(projectId: string | null = "p1") {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{}}>
        <div className="workspace-v2 h-full flex flex-col" data-testid="ws">
          <ThemeBackdrop projectId={projectId} />
          <section className="relative flex flex-col flex-1 bg-preview-a" data-testid="canvas">
            <div className="rounded-xl overflow-hidden" style={{ background: "#ffffff" }}>
              <iframe title="page" />
            </div>
          </section>
        </div>
      </NextIntlClientProvider>,
    );
  });
  await settle();
  return { ws: host.querySelector<HTMLElement>(".workspace-v2")!, root };
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("ThemeBackdrop", () => {
  it("paints the scene behind the workspace", async () => {
    answer = state(LAGOON);
    const { ws } = await mount("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/themes?project=p1&locale=es", expect.objectContaining({ cache: "no-store" }));
    const img = ws.querySelector("img")!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(img.getAttribute("src")).toBe(LAGOON.sceneUrl);
    expect(img.style.position).toBe("fixed");
    expect(Number(img.style.zIndex)).toBeLessThan(0);
    expect(img.style.objectFit).toBe("cover");
    expect(img.style.pointerEvents).toBe("none");
    expect(ws.hasAttribute("data-theme-glass")).toBe(true);
    expect(ws.hasAttribute("data-theme-layer")).toBe(true);
    expect(ws.style.getPropertyValue("--glass-tint")).toBe("#e6fbff");
    expect(ws.style.getPropertyValue("--glass-opacity")).toBe("0.42");
    expect(ws.style.getPropertyValue("--glass-blur")).toBe("7px");
    // A fast machine: the scene keeps moving.
    expect(guard.measured).toBe(1);
    expect(img.getAttribute("src")).toBe(LAGOON.sceneUrl);
  });

  it("a glass with no tint sets none: the CSS falls back to the root's own --bg, never transparent", async () => {
    answer = state({ ...LAGOON, glass: { blur: 7, opacity: 0.42 } });
    const { ws } = await mount();
    expect(ws.hasAttribute("data-theme-glass")).toBe(true);
    expect(ws.style.getPropertyValue("--glass-tint")).toBe("");
    expect(ws.style.getPropertyValue("--glass-opacity")).toBe("0.42");
  });

  it("asks only for «everywhere» with no project open", async () => {
    await mount(null);
    expect(fetchMock).toHaveBeenCalledWith("/api/themes?locale=es", expect.anything());
  });

  it("uses the twin that matches the person's mode and forces nothing", async () => {
    window.localStorage.setItem("inari:dark", "1");
    document.documentElement.classList.add("dark");
    answer = state(DAWN, DUSK);
    const { ws } = await mount();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(DUSK.sceneUrl);
    expect(ws.style.getPropertyValue("--glass-tint")).toBe("#1f2336");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("inari:dark")).toBe("1");
  });

  it("the theme itself when it already matches the person's mode", async () => {
    window.localStorage.setItem("inari:dark", "0");
    answer = state(DAWN, DUSK);
    const { ws } = await mount();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(DAWN.sceneUrl);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("forces the theme's mode without touching inari:dark, and gives the class back when the theme goes", async () => {
    window.localStorage.setItem("inari:dark", "0");
    answer = state(REEF);
    const { ws } = await mount();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("inari:dark")).toBe("0");

    answer = state(null);
    await act(async () => reloadWorkspaceThemes());
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("inari:dark")).toBe("0");
    expect(ws.querySelector("img")).toBeNull();
    expect(ws.hasAttribute("data-theme-glass")).toBe(false);
    expect(ws.hasAttribute("data-theme-layer")).toBe(false);
    expect(ws.style.getPropertyValue("--glass-tint")).toBe("");
  });

  it("gives the class back on unmount too, and a light theme over a dark person forces light the same way", async () => {
    // Nothing saved and a system that prefers dark: the pre-paint script put `.dark` on, and that is the person's mode.
    systemDark = true;
    document.documentElement.classList.add("dark");
    answer = state(LAGOON);
    const { root } = await mount();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("inari:dark")).toBeNull();
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("decides the person's mode as the toggle does: with nothing saved, the system's preference — never the class", async () => {
    // The class says light but the system prefers dark and nothing is saved: `useDarkMode` calls that person dark, so the
    // layer does too, and paints the dark twin without forcing anything.
    systemDark = true;
    answer = state(DAWN, DUSK);
    const { ws } = await mount();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(DUSK.sceneUrl);
    // A saved setting wins over the system, for both.
    window.localStorage.setItem("inari:dark", "0");
    await act(async () => reloadWorkspaceThemes());
    await act(async () => document.documentElement.classList.toggle("x"));
    await settle();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(DAWN.sceneUrl);
  });

  it("marks <html> with the window it forces while it forces it, and only then", async () => {
    window.localStorage.setItem("inari:dark", "0");
    answer = state(REEF);
    await mount();
    expect(document.documentElement.getAttribute("data-theme-forced-window")).toBe("dark");
    answer = state(DAWN, DUSK);
    await act(async () => reloadWorkspaceThemes());
    await settle();
    expect(document.documentElement.hasAttribute("data-theme-forced-window")).toBe(false);
  });

  it("palette and font are set as custom properties, never as a stylesheet", async () => {
    const styles = document.querySelectorAll("style, link[rel=stylesheet]").length;
    answer = state({ ref: "installed:i1:paleta", window: "light", glass: false, colors: { "--fg": "#112233", "--bg": "#fafafa", "--accent": "#ff00aa" }, font: "serif", heavy: false, title: "Paleta" });
    const { ws } = await mount();
    expect(ws.style.getPropertyValue("--fg")).toBe("#112233");
    expect(ws.style.getPropertyValue("--bg")).toBe("#fafafa");
    expect(ws.style.getPropertyValue("--accent")).toBe("#ff00aa");
    expect(ws.style.getPropertyValue("--theme-font")).toMatch(/serif$/);
    expect(ws.hasAttribute("data-theme-font")).toBe(true);
    expect(ws.hasAttribute("data-theme-glass")).toBe(false);
    expect(ws.querySelector("img")).toBeNull();
    expect(document.querySelectorAll("style, link[rel=stylesheet]").length).toBe(styles);
  });

  it("under glass, the palette leaves the three glass backgrounds to the glass", async () => {
    answer = state({ ...LAGOON, colors: { "--bg": "#ffffff", "--bg-sidebar": "#eeeeee", "--bg-elev": "#dddddd", "--fg": "#001122" } });
    const { ws } = await mount();
    expect(ws.style.getPropertyValue("--fg")).toBe("#001122");
    expect(ws.style.getPropertyValue("--bg")).toBe("");
    expect(ws.style.getPropertyValue("--bg-sidebar")).toBe("");
    expect(ws.style.getPropertyValue("--bg-elev")).toBe("");
  });

  it("code is a monospace stack", async () => {
    answer = state({ ref: "bundled:x", window: "light", glass: false, font: "code", heavy: false, title: "x" });
    const { ws } = await mount();
    expect(ws.style.getPropertyValue("--theme-font")).toMatch(/monospace$/);
  });

  it("still ground paints no img and no glass", async () => {
    answer = state({
      ref: "installed:i1:quieto",
      window: "light",
      glass: false,
      ground: { gradient: { stops: [{ color: "#ff0000", at: 0 }, { color: "#0000ff", at: 1 }], angle: 90 } },
      heavy: false,
      title: "Quieto",
    });
    const { ws } = await mount();
    expect(ws.querySelector("img")).toBeNull();
    expect(ws.hasAttribute("data-theme-glass")).toBe(false);
    expect(ws.hasAttribute("data-theme-layer")).toBe(true);
    const ground = ws.querySelector<HTMLElement>("[data-theme-ground]")!;
    expect(ground.style.position).toBe("fixed");
    expect(Number(ground.style.zIndex)).toBeLessThan(0);
    expect(ground.style.backgroundImage).toContain("linear-gradient(90deg");
    expect(ground.style.backgroundImage).toContain("#ff0000 0%");
    expect(ground.style.backgroundImage).toContain("#0000ff 100%");
    expect(guard.measured).toBe(0);
  });

  it("a still ground of color, and one of vector paths as an SVG that is only data", async () => {
    answer = state({ ref: "a", window: "light", glass: false, ground: { color: "#123456" }, heavy: false, title: "a" });
    let { ws } = await mount();
    expect(ws.querySelector<HTMLElement>("[data-theme-ground]")!.style.backgroundColor).not.toBe("");
    for (const r of roots.splice(0)) act(() => r.unmount());
    host.remove();

    answer = state({
      ref: "b",
      window: "dark",
      glass: false,
      ground: { vector: { viewBox: "0 0 10 10", paths: [{ d: "M0 0L10 10" }, { d: "M0 10L10 0", color: "#00ff00", strokeWidth: 2 }], color: "#ff0000", size: "40px 40px", repeat: true } },
      heavy: false,
      title: "b",
    });
    ({ ws } = await mount());
    const ground = ws.querySelector<HTMLElement>("[data-theme-ground]")!;
    const image = ground.style.backgroundImage;
    expect(image.startsWith('url("data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(image.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain('viewBox="0 0 10 10"');
    expect(svg).toContain('<path d="M0 0L10 10" fill="#ff0000" fill-rule="evenodd"/>');
    expect(svg).toContain('stroke="#00ff00" stroke-width="2"');
    expect(svg).not.toMatch(/script|href/i);
    expect(ground.style.backgroundSize).toBe("40px 40px");
    expect(ground.style.backgroundRepeat).toBe("repeat");
  });

  it("a slow machine: the scene is swapped for the still one after two seconds of frames", async () => {
    guard.fps = 44;
    answer = state(REEF);
    const { ws } = await mount();
    expect(guard.measured).toBe(1);
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(REEF.stillUrl);
  });

  it("WebGL by software: starts still, without measuring", async () => {
    guard.renderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)";
    answer = state(LAGOON);
    const { ws } = await mount();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(LAGOON.stillUrl);
    expect(guard.measured).toBe(0);
  });

  it("reduced motion: starts on the still scene, without measuring", async () => {
    reducedMotion = true;
    answer = state(LAGOON);
    const { ws } = await mount();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(LAGOON.stillUrl);
    expect(guard.measured).toBe(0);
  });

  it("themes off (404) or a failed read: no layer, and nothing in the console", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    answer = { status: 404, body: { error: "themes_off" } };
    let { ws } = await mount();
    expect(ws.querySelector("img")).toBeNull();
    expect(ws.hasAttribute("data-theme-layer")).toBe(false);
    for (const r of roots.splice(0)) act(() => r.unmount());
    host.remove();

    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    ({ ws } = await mount());
    expect(ws.querySelector("img")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("a scene that does not load takes the whole layer with it", async () => {
    answer = state(LAGOON);
    const { ws } = await mount();
    const img = ws.querySelector("img")!;
    await act(async () => { img.dispatchEvent(new Event("error")); });
    expect(ws.querySelector("img")).toBeNull();
    expect(ws.hasAttribute("data-theme-glass")).toBe(false);
  });

  it("a preview lives in this tab only: it asks for the ref and paints it, and ending it paints the pick again", async () => {
    answer = state(LAGOON);
    previewAnswer = REEF;
    const { ws } = await mount();
    await act(async () => previewWorkspaceTheme("bundled:night-reef"));
    await settle();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/themes?project=p1&locale=es&preview=bundled%3Anight-reef", expect.anything());
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(REEF.sceneUrl);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);

    await act(async () => previewWorkspaceTheme(null));
    await settle();
    expect(ws.querySelector("img")!.getAttribute("src")).toBe(LAGOON.sceneUrl);
  });
});

describe("the client's canvas stays opaque", () => {
  const repo = process.cwd();
  // The rules only: a comment may name what a rule must not touch.
  const tokens = readFileSync(join(repo, "app/[locale]/new/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const glassRules = [...tokens.matchAll(/([^{}]*\[data-theme-glass\][^{}]*)\{([^}]*)\}/g)];
  // The glass lives inside one `@media (min-width: 768px)`; jsdom applies no media query, so a document that has to
  // compute the glass gets the rules as a desktop-wide window sees them.
  const DESKTOP_ONLY = /@media\s*\(min-width:\s*768px\)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/;
  const desktopTokens = tokens.replace(DESKTOP_ONLY, (_all, inner: string) => inner);

  it("the glass never redefines the canvas's own background", () => {
    expect(glassRules.length).toBeGreaterThan(0);
    for (const [, selector, body] of glassRules) {
      expect(body, selector).not.toContain("--bg-preview");
      expect(selector, selector).not.toContain("bg-preview");
    }
  });

  it("the preview's margins show the scene, its control rows are glass, and the page's frame keeps a white base", () => {
    // Only the zone's own background goes: no token is redefined, so the lenses that cover it (bg-app) stay opaque.
    const margin = /\.workspace-v2\[data-theme-layer\] \[data-glass-margin\]\s*\{([^}]*)\}/.exec(tokens);
    expect(margin).not.toBeNull();
    expect(margin![1]).toMatch(/background-color:\s*transparent/);
    expect(margin![1]).not.toMatch(/--bg/);
    const preview = readFileSync(join(repo, "components/workspace-v2/preview-area.tsx"), "utf8");
    expect(preview).toMatch(/<section\s+data-glass-margin=""\s+className="relative flex flex-col[^"]*bg-preview-a"/);
    expect([...preview.matchAll(/<div data-glass-surface="" className="relative z-(20|10) h-(10|9) /g)]).toHaveLength(2);
    expect(preview).toMatch(/backgroundColor: "#ffffff", backgroundImage: `linear-gradient\(\$\{pageBg\}, \$\{pageBg\}\)`/);
  });

  it("under a theme the canvas paints an opaque base below its own colour, whatever a palette says", () => {
    expect(tokens).toMatch(/\.workspace-v2\[data-theme-layer\] \.bg-preview-a:not\(\[data-glass-margin\]\)\s*\{[^}]*background-color:\s*var\(--bg-preview-base\)/);
    // The base is a token of both windows, the same values as `--bg-preview`, and no palette can name it.
    expect(tokens).toMatch(/\.workspace-v2 \{[^}]*--bg-preview-base:\s*oklch\(96\.4% 0\.004 12\)/);
    expect(tokens).toMatch(/\.dark \.workspace-v2 \{[^}]*--bg-preview-base:\s*oklch\(10% 0\.01 12\)/);
    expect((THEME_TOKENS as readonly string[]).includes("--bg-preview-base")).toBe(false);
  });

  it("the glass is only on marked surfaces: the root and every unmarked surface keep their opaque colours", () => {
    const rootRule = glassRules.find(([, selector]) => selector.trim() === ".workspace-v2[data-theme-glass]");
    expect(rootRule).toBeDefined();
    for (const token of ["--bg:", "--bg-sidebar:", "--bg-elev:"]) expect(rootRule![2]).not.toContain(token);
    for (const [, selector] of glassRules) {
      expect(
        selector.trim().startsWith(".workspace-v2[data-theme-glass] [data-glass-surface]") ||
          selector.trim() === ".workspace-v2[data-theme-glass] [data-glass-stage]" ||
          selector.trim() === ".workspace-v2[data-theme-glass]",
        selector,
      ).toBe(true);
      expect(selector, selector).not.toMatch(/bg-(app|side|elev)/);
    }
    // A stage (the centre of the screen) is no glass: transparent, no tint, no blur — the scene shows in its margins.
    const stage = glassRules.find(([, selector]) => selector.trim() === ".workspace-v2[data-theme-glass] [data-glass-stage]");
    expect(stage).toBeDefined();
    expect(stage![2]).toMatch(/background-color:\s*transparent/);
    expect(stage![2]).not.toMatch(/blur|color-mix/);
    // Inside a marked surface what paints the workshop's or the bar's ground lets the glass through; cards stay opaque.
    const surface = glassRules.find(([, selector]) => selector.trim() === ".workspace-v2[data-theme-glass] [data-glass-surface]")!;
    expect(surface[2]).toMatch(/--bg:\s*transparent/);
    expect(surface[2]).toMatch(/--bg-sidebar:\s*transparent/);
    expect(surface[2]).not.toContain("--bg-elev");
    // No tint → the root's own --bg, never transparent.
    expect(surface[2]).toContain("var(--glass-tint, var(--glass-fallback))");
    expect(rootRule![2]).toMatch(/--glass-fallback:\s*var\(--bg\)/);
  });

  it("no glass on a phone: every rule that tints or blurs a marked surface is inside @media (min-width: 768px)", () => {
    // On a phone the open rail panel lies OVER the client's canvas (`max-md:absolute`): there it keeps its opaque tokens.
    const media = DESKTOP_ONLY.exec(tokens);
    expect(media).not.toBeNull();
    const inside = media![1]!;
    const outside = tokens.replace(media![0], "");
    const surfaceRules = glassRules.filter(([, selector]) => selector.includes("[data-glass-surface]"));
    expect(surfaceRules.length).toBe(4);
    for (const [whole] of surfaceRules) expect(inside, whole).toContain(whole.trim());
    expect(outside).not.toContain("[data-glass-surface]");
    // What stays outside is only the root's fallback tint, which paints nothing by itself.
    expect(outside).toMatch(/\.workspace-v2\[data-theme-glass\]\s*\{\s*--glass-fallback:\s*var\(--bg\);\s*\}/);
  });

  it("the blur sits on a ::before, never on the surface: a position: fixed child is not trapped", () => {
    const withBlur = [...tokens.matchAll(/([^{}]*)\{([^}]*backdrop-filter[^}]*)\}/g)].filter(([, selector]) => selector.includes("data-theme"));
    expect(withBlur.length).toBe(1);
    expect(withBlur[0]![1].trim()).toBe(".workspace-v2[data-theme-glass] [data-glass-surface]::before");
    expect(withBlur[0]![2]).toMatch(/position:\s*absolute/);
    expect(withBlur[0]![2]).toMatch(/z-index:\s*-1/);
    // Nothing in the theme's rules gives an element a transform, a filter or a backdrop-filter of its own.
    for (const [, selector, body] of [...tokens.matchAll(/([^{}]*data-theme[^{}]*)\{([^}]*)\}/g)]) {
      if (selector.trim().endsWith("::before")) continue;
      expect(body, selector).not.toMatch(/(^|[;\s])(-webkit-)?(backdrop-filter|filter|transform|will-change|contain|perspective)\s*:/);
    }
  });

  it("in a document with the theme's rules, the fixed chat inside the glass rail has no blurred or transformed ancestor", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = desktopTokens;
    document.head.appendChild(sheet);
    try {
      answer = state(LAGOON);
      const { ws } = await mount();
      const rail = document.createElement("aside");
      rail.setAttribute("data-glass-surface", "");
      rail.className = "relative h-full bg-side";
      const chat = document.createElement("div");
      chat.style.position = "fixed";
      rail.appendChild(chat);
      ws.appendChild(rail);
      expect(ws.hasAttribute("data-theme-glass")).toBe(true);
      const own = getComputedStyle(rail);
      expect(own.getPropertyValue("--bg-sidebar").trim()).toBe("transparent");
      for (let el: Element | null = chat.parentElement; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        for (const prop of ["backdrop-filter", "-webkit-backdrop-filter", "filter", "transform"]) {
          expect(["", "none"], `${el.tagName}.${prop}`).toContain(cs.getPropertyValue(prop));
        }
      }
    } finally {
      sheet.remove();
    }
  });

  it("the marked surfaces: the rail (both widths, Len's docked panel inside), the top bar and the start rail, each positioned", () => {
    const marked = (file: string) => {
      const src = readFileSync(join(repo, file), "utf8");
      return [...src.matchAll(/<(aside|header|div|nav|section)\s[^>]*data-glass-surface=""[^>]*>/g)].map((m) => m[0]);
    };
    const sidebar = marked("components/workspace-v2/left-sidebar.tsx");
    expect(sidebar).toHaveLength(2);
    for (const tag of sidebar) expect(tag).toMatch(/className=\{?[`"]relative /);
    const bar = marked("components/workspace-v2/top-bar.tsx");
    expect(bar).toHaveLength(1);
    expect(bar[0]).toMatch(/className="relative /);
    const start = readFileSync(join(repo, "components/workspace-v2/start-rail.tsx"), "utf8");
    expect(start).toMatch(/data-start-rail\n[^<]*data-glass-surface=""\n[\s\S]{0,400}"relative hidden shrink-0/);
    // The start screen's centre (and its quiet wait), Herramientas and Mis páginas are STAGES, not glass: the scene shows
    // in their margins, as beside Claude Code's chat (seen in the browser on 27/11: a glass centre washed the whole scene
    // out). Only the content column of Herramientas and Mis páginas is glass, positioned.
    const staged = (file: string) => {
      const src = readFileSync(join(repo, file), "utf8");
      return [...src.matchAll(/<(div|section)\s[^>]*data-glass-stage=""[^>]*>/g)].map((m) => m[0]);
    };
    expect(marked("app/[locale]/new/page.tsx")).toHaveLength(0);
    expect(staged("app/[locale]/new/page.tsx")).toHaveLength(2);
    for (const file of ["components/workspace-v2/tools/tools-view.tsx", "app/[locale]/projects/projects-section.tsx"]) {
      expect(staged(file), file).toHaveLength(1);
      const columns = marked(file);
      expect(columns, file).toHaveLength(1);
      expect(columns[0], file).toMatch(/className="relative mx-auto /);
    }
    // Menus stay unmarked: they hang over the client's canvas.
    expect(marked("components/workspace-v2/account-menu.tsx")).toHaveLength(0);
  });

  it("a marked surface inside another tints and blurs nothing of its own", () => {
    const nested = glassRules.filter(([, selector]) => /\[data-glass-surface\] \[data-glass-surface\]/.test(selector));
    const plain = nested.find(([, selector]) => !selector.includes("::before"));
    const before = nested.find(([, selector]) => selector.trim().endsWith("::before"));
    expect(plain?.[2]).toMatch(/background-color:\s*transparent/);
    expect(before?.[2]).toMatch(/content:\s*none/);
  });

  it("the layer is the root's FIRST child in /new, and its <img> comes first in it: the glass's ::before outpaints it only by document order", async () => {
    // A marked surface is positioned with no z-index: its ::before (-1) and the scene (-1) share the root's stacking
    // context, and at equal z-index what comes first paints first. tokens.css says why.
    const page = readFileSync(join(repo, "app/[locale]/new/page.tsx"), "utf8");
    const afterRoot = page.split('<div className="workspace-v2 h-full flex flex-col">')[1] ?? "";
    const firstElement = afterRoot.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trimStart();
    expect(firstElement.startsWith("<ThemeBackdrop ")).toBe(true);
    answer = state(LAGOON);
    const { ws } = await mount();
    const backdrop = ws.querySelector("[data-theme-backdrop]")!;
    expect(ws.firstElementChild).toBe(backdrop);
    expect(backdrop.firstElementChild?.tagName).toBe("IMG");
  });

  it("the canvas is `bg-preview-a` and the page's frame paints the page's own ground", () => {
    const area = readFileSync(join(repo, "components/workspace-v2/preview-area.tsx"), "utf8");
    expect(area).toContain('className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-preview-a"');
    expect(area).toMatch(/style=\{\{ height: 800 \* scale, backgroundColor: "#ffffff", backgroundImage: `linear-gradient\(\$\{pageBg\}, \$\{pageBg\}\)` \}\}/);
    expect(area).toMatch(/\|\| "#ffffff"/);
  });

  it("the layer marks only the workspace's root: the canvas and the page's iframe get nothing", async () => {
    answer = state(LAGOON);
    const { ws } = await mount();
    expect(ws.hasAttribute("data-theme-glass")).toBe(true);
    const canvas = ws.querySelector<HTMLElement>("[data-testid=canvas]")!;
    expect(canvas.hasAttribute("data-theme-glass")).toBe(false);
    expect(canvas.getAttribute("style")).toBeNull();
    const iframe = ws.querySelector("iframe")!;
    expect(iframe.hasAttribute("data-theme-glass")).toBe(false);
    expect(iframe.getAttribute("style")).toBeNull();
    expect(ws.querySelectorAll("[data-theme-glass]").length).toBe(0);
  });
});
