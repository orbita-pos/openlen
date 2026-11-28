// WHAT A THEME PROJECT IS BORN WITH (spec local 2026-11-27-temas-del-workspace, §4.1, §4.5): a manifest with a light scene
// theme and its dark twin, the scenes behind them, the display record, a preview page that paints a fake workspace over
// the scene with the manifest's glass, and one line of memory. All of it has to be what the install door accepts: the
// skeleton is the first thing `readThemeManifest` and `checkScene` ever see of a new theme.
import { describe, expect, it } from "vitest";

import { readThemeManifest } from "./manifest";
import { checkScene } from "./scene-check";
import { themeSkeleton } from "./skeleton";

const born = (locale = "es") => themeSkeleton({ title: "Theme", locale });

describe("themeSkeleton: the manifest", () => {
  it("🔴 reads as a manifest, in English and in the person's language: a light scene and its dark twin", () => {
    for (const locale of ["en", "es", "ja"]) {
      const s = born(locale);
      const r = readThemeManifest(s.files, { personLocale: locale });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.themes.map((t) => [t.id, t.window, t.twin, t.scene])).toEqual([
        ["scene", "light", "scene-night", "/themes/scene.svg"],
        ["scene-night", "dark", "scene", "/themes/scene-night.svg"],
      ]);
      for (const t of r.themes) {
        expect(t.glass).toEqual({ blur: expect.any(Number), opacity: expect.any(Number), tint: expect.stringMatching(/^#[0-9a-f]{6}$/) });
        expect(t.titles.en).toBeTruthy();
        expect(t.titles[locale]).toBeTruthy();
        expect(t.blurbs[locale]).toBeTruthy();
      }
    }
  });

  it("carries a locale file for English, and one more only when the person speaks another language", () => {
    expect(Object.keys(born("en").files).filter((p) => p.startsWith("/locale/"))).toEqual(["/locale/en.json"]);
    expect(Object.keys(born("es").files).filter((p) => p.startsWith("/locale/")).sort()).toEqual(["/locale/en.json", "/locale/es.json"]);
  });

  // `idioma` is any string the first message carries, and the birth writes its rows by raw SQL, past the folder's path
  // rules: the locale is a path segment, so it is normalised as an app's `lang` is (`idiomaDe`) — never taken as written.
  it("🔴 a locale that is not a language code never becomes a path: only /locale/en.json is written", () => {
    for (const locale of ["../../x", "../x", "es/../../x", "a/b", "", "es\n", "x".repeat(40), "es-"]) {
      const paths = Object.keys(born(locale).files);
      expect(paths.filter((p) => p.startsWith("/locale/")), JSON.stringify(locale)).toEqual(["/locale/en.json"]);
      expect(paths.some((p) => p.includes("..")), JSON.stringify(locale)).toBe(false);
    }
  });

  it("a regional language code is kept, and reads as a manifest for that person", () => {
    const s = born("pt-BR");
    expect(Object.keys(s.files).filter((p) => p.startsWith("/locale/")).sort()).toEqual(["/locale/en.json", "/locale/pt-BR.json"]);
    expect(readThemeManifest(s.files, { personLocale: "pt-BR" }).ok).toBe(true);
  });

  it("is a project with no React and no /src: the manifest, the display record, the scenes, the preview and a line of memory", () => {
    expect(Object.keys(born("es").files).sort()).toEqual([
      "/LEN.md",
      "/locale/en.json",
      "/locale/es.json",
      "/package.json",
      "/themes/preview.html",
      "/themes/scene-night.svg",
      "/themes/scene.svg",
    ]);
  });

  it("is born now, and says so", () => {
    expect(born().theme).toEqual({ bornAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(Number.isNaN(Date.parse(born().theme.bornAt))).toBe(false);
  });
});

describe("themeSkeleton: the scenes", () => {
  it("🔴 pass the scene's gate, light and not heavy, and already carry the reduced-motion rule", () => {
    const s = born();
    for (const path of ["/themes/scene.svg", "/themes/scene-night.svg"]) {
      const checked = checkScene(s.files[path]!, path);
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
      if (!checked.ok) return;
      expect(checked.addedReducedMotion).toBe(false);
      expect(checked.cost.heavy).toBe(false);
      expect(checked.cost.animated).toBeGreaterThan(0);
    }
  });

  it("move with CSS alone, slowly: keyframes, never SMIL, and nothing that runs", () => {
    const s = born();
    for (const path of ["/themes/scene.svg", "/themes/scene-night.svg"]) {
      const svg = s.files[path]!;
      expect(svg).toContain("@keyframes");
      expect(svg).not.toMatch(/<(animate|animateTransform|animateMotion|set)\b|<script|<foreignObject|\son[a-z]+=/i);
      // Every cycle lasts a good while: «to sit under hours of work».
      const seconds = [...svg.matchAll(/animation(?:-duration)?:[^;}]*?(\d+(?:\.\d+)?)s\b/g)].map((m) => Number(m[1]));
      expect(seconds.length).toBeGreaterThan(0);
      expect(Math.min(...seconds)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("themeSkeleton: the preview", () => {
  it("is the project's html and its file", () => {
    const s = born();
    expect(s.html).toBe(s.files["/themes/preview.html"]);
  });

  it("🔴 paints a fake workspace over each scene, in an <img>, with the manifest's own glass", () => {
    const s = born();
    const r = readThemeManifest(s.files, { personLocale: "es" });
    if (!r.ok) throw new Error("the manifest must read");
    for (const t of r.themes) {
      expect(s.html).toContain(`<img class="scene" src="${t.scene}"`);
      const glass = t.glass as { blur: number; opacity: number; tint: string };
      expect(s.html).toContain(`--blur:${glass.blur}px;--opacity:${glass.opacity};--tint:${glass.tint}`);
    }
    // The workspace's way of making glass (spec §4.3, R19): the tint on the surface, the blur on a ::before.
    expect(s.html).toMatch(/color-mix\(in oklch, var\(--tint\) calc\(var\(--opacity\) \* 100%\), transparent\)/);
    expect(s.html).toMatch(/::before\s*\{[^}]*backdrop-filter:\s*blur\(var\(--blur\)\)/);
    // A rail, a panel with text, and the client's page: white, with nothing of the scene behind it.
    expect(s.html).toContain('class="rail"');
    expect(s.html).toContain('class="panel"');
    expect(s.html).toMatch(/\.canvas\s*\{[^}]*background:\s*#fff/);
  });

  it("needs nothing to be fetched and runs nothing", () => {
    const { html } = born();
    expect(html).not.toMatch(/<script|fetch\(|XMLHttpRequest|https?:\/\//i);
  });
});

describe("themeSkeleton: the memory", () => {
  it("/LEN.md is one line that says this is a workspace theme", () => {
    const text = born().files["/LEN.md"]!;
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(text).toMatch(/theme/i);
    expect(text).toContain("/themes");
    expect(text).toContain("/package.json");
  });
});
