// @vitest-environment node
// THE GALLERY THAT COMES WITH OPENLEN: Claude Code's `theme-examples` scenes (Apache-2.0), copied as they are. These
// tests hold what the generator (`scripts/themes-bundle.mjs`) must have left: how many there are, what each is called,
// that every one is a theme OpenLen's own gates take, and that nothing was edited on the way.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readThemeManifest } from "../manifest";
import { checkScene } from "../scene-check";
import { BUNDLED_THEMES, bundledSceneSvg } from "./index";

const DIR = dirname(fileURLToPath(import.meta.url));

type Expected = { title: string; window: "light" | "dark"; twin?: string };

// Claude Code's own `id` and `title`, one row each. The nine nights of the nine interactive pictures are not here: a
// picture that a shader plays over comes in with its still, once, in its light entry (spec §9, decision 5), so those
// have no twin to name.
const EXPECTED: Record<string, Expected> = {
  "honu-lagoon": { title: "Honu Lagoon", window: "light" },
  "koi-mosaic": { title: "Koi Mosaic", window: "light" },
  "halftone-dawn": { title: "Halftone Dawn", window: "light", twin: "halftone-dusk" },
  "halftone-dusk": { title: "Halftone Dusk", window: "dark", twin: "halftone-dawn" },
  "plotter-tide": { title: "Plotter Tide", window: "light", twin: "plotter-tide-night" },
  "plotter-tide-night": { title: "Plotter Tide, Night", window: "dark", twin: "plotter-tide" },
  "dither-dunes": { title: "Dither Dunes", window: "light", twin: "dither-dunes-night" },
  "dither-dunes-night": { title: "Dither Dunes Night", window: "dark", twin: "dither-dunes" },
  "paper-garden": { title: "Paper Garden", window: "light", twin: "paper-garden-kraft" },
  "paper-garden-kraft": { title: "Paper Garden, Kraft", window: "dark", twin: "paper-garden" },
  "night-reef": { title: "Night Reef", window: "dark" },
  "snow-pines": { title: "Snow Pines", window: "dark" },
  "braille-stars": { title: "Braille Stars", window: "dark" },
  "teletext-clouds": { title: "Block Clouds", window: "dark" },
  "vector-range": { title: "Vector Range", window: "dark" },
  "departure-board": { title: "Departure Board", window: "dark" },
  blueprint: { title: "Blueprint", window: "dark" },
  "deep-water": { title: "Deep Water", window: "dark" },
  aurora: { title: "Aurora", window: "dark" },
  ember: { title: "Ember", window: "dark" },
  "duck-pond": { title: "Duck Pond", window: "light" },
  "falling-sand": { title: "Falling Sand", window: "light" },
  "field-lines": { title: "Field Lines", window: "light" },
  "garden-beetles": { title: "Garden Beetles", window: "light" },
  "koi-pond": { title: "Koi Pond", window: "light" },
  "ripple-tank": { title: "Ripple Tank", window: "light" },
  "sea-sparkle": { title: "Sea Sparkle", window: "light" },
  semicolony: { title: "Semicolony", window: "light" },
  "star-chart": { title: "Star Chart", window: "light" },
};

/** The nine pictures a shader plays over in Claude Code: here only their stills, which do not move. */
const STILLS = [
  "duck-pond",
  "falling-sand",
  "field-lines",
  "garden-beetles",
  "koi-pond",
  "ripple-tank",
  "sea-sparkle",
  "semicolony",
  "star-chart",
];

/** Scenes that move and whose own reduced-motion rule also hides some details at rest, which `addedReducedMotion` does not read as the plain one. */
const HIDE_DETAILS_AT_REST = ["koi-mosaic", "dither-dunes", "dither-dunes-night"];

const byId = new Map(BUNDLED_THEMES.map((t) => [t.id, t]));
const sceneOf = (id: string): string => {
  const svg = bundledSceneSvg(id);
  if (svg === null) throw new Error(`no scene for ${id}`);
  return svg;
};

describe("the bundled gallery", () => {
  it("is the 20 scenes that do not need a shader and the 9 stills of those that do", () => {
    expect(BUNDLED_THEMES).toHaveLength(29);
    expect(BUNDLED_THEMES.map((t) => t.id).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(new Set(BUNDLED_THEMES.map((t) => t.id)).size).toBe(29);
  });

  it("keeps Claude Code's id, window, title and blurb for each, with the title and blurb in en", () => {
    for (const [id, want] of Object.entries(EXPECTED)) {
      const theme = byId.get(id)!;
      expect(theme.window, id).toBe(want.window);
      expect(theme.titles, id).toEqual({ en: want.title });
      expect(Object.keys(theme.blurbs), id).toEqual(["en"]);
      expect(theme.blurbs.en!.length, id).toBeGreaterThan(10);
    }
    // One with an apostrophe, written with a backslash in Claude Code's source.
    expect(byId.get("plotter-tide-night")!.blurbs.en).toBe("The plotter's tide chart in pale ink on blue-black night paper.");
  });

  it("has twins only where both entries are here, each naming the other, one light and one dark", () => {
    const withTwin = BUNDLED_THEMES.filter((t) => t.twin !== undefined);
    expect(withTwin.map((t) => t.id).sort()).toEqual(
      Object.entries(EXPECTED)
        .filter(([, e]) => e.twin !== undefined)
        .map(([id]) => id)
        .sort(),
    );
    // Halftone, Plotter Tide, Dither Dunes and Paper Garden: four pairs.
    expect(withTwin).toHaveLength(8);
    for (const theme of withTwin) {
      const twin = byId.get(theme.twin!);
      expect(twin, `${theme.id} names ${theme.twin}, which is not bundled`).toBeDefined();
      expect(twin!.twin, theme.id).toBe(theme.id);
      expect(twin!.window, theme.id).not.toBe(theme.window);
    }
    // A still of an interactive scene has lost the dark entry that was its twin.
    for (const id of STILLS) expect(byId.get(id)!.twin, id).toBeUndefined();
  });

  it("gives every theme a scene file and the glass its row declares", () => {
    for (const theme of BUNDLED_THEMES) {
      expect(theme.scene, theme.id).toBe(`${theme.id}.svg`);
      expect(theme.glass, theme.id).toBeTypeOf("object");
    }
    expect(byId.get("honu-lagoon")!.glass).toEqual({ blur: 7, tint: "#e6fbff", opacity: 0.42 });
    expect(byId.get("plotter-tide")!.glass).toEqual({ blur: 0, tint: "#f4efe4", opacity: 0.32 });
    expect(byId.get("vector-range")!.glass).toEqual({ blur: 22, tint: "#0e2f27", opacity: 0.42 });
    expect(byId.get("star-chart")!.glass).toEqual({ blur: 16, tint: "#ece2ca", opacity: 0.6 });
  });

  it("holds one .svg for each theme and no other", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".svg")).sort();
    expect(files).toEqual(BUNDLED_THEMES.map((t) => t.scene!).sort());
  });

  it("is a manifest OpenLen's own gate takes, whole, with each scene where it says", () => {
    const themes = BUNDLED_THEMES.map((t) => ({
      id: t.id,
      window: t.window,
      ...(t.twin !== undefined && { twin: t.twin }),
      scene: `/themes/${t.scene}`,
      glass: t.glass,
    }));
    const locale = {
      themes: Object.fromEntries(BUNDLED_THEMES.map((t) => [t.id, { title: t.titles.en, blurb: t.blurbs.en }])),
    };
    const files: Record<string, string> = {
      "/package.json": JSON.stringify({ name: "gallery", version: "1.0.0", openlen: { theme: { themes } } }),
      "/locale/en.json": JSON.stringify(locale),
      ...Object.fromEntries(BUNDLED_THEMES.map((t) => [`/themes/${t.scene}`, sceneOf(t.id)])),
    };
    const result = readThemeManifest(files, { personLocale: "en" });
    if (!result.ok) throw new Error(`the gallery is not a manifest: ${JSON.stringify(result.problems)}`);
    expect(result.themes).toHaveLength(29);
    for (const read of result.themes) {
      const own = byId.get(read.id)!;
      expect(read.glass, read.id).toEqual(own.glass);
      expect(read.window, read.id).toBe(own.window);
      expect(read.twin, read.id).toBe(own.twin);
    }
  });

  it("passes the scene gate, and the 20 that move each carry their own reduced-motion rule", () => {
    for (const theme of BUNDLED_THEMES) {
      const svg = sceneOf(theme.id);
      const result = checkScene(svg, `${theme.id}.svg`);
      if (!result.ok) throw new Error(`${theme.id} fails the gate: ${JSON.stringify(result.problem)}`);
      if (STILLS.includes(theme.id)) continue;
      expect(result.cost.animated, theme.id).toBeGreaterThan(0);
      // Claude Code's scenes that move stop when the system asks for less motion: the file has the rule, so none of
      // them needs the gate's to be put into the file (it is put in when the scene is served, whatever they say).
      expect(svg, theme.id).toMatch(/prefers-reduced-motion\s*:\s*reduce/);
      // The gate's report of `addedReducedMotion` looks for the plain rule `*{animation:none!important}` and nothing
      // else in the block: three scenes also hide a few details in theirs (`.grain{opacity:0}`), so it reports those.
      if (!HIDE_DETAILS_AT_REST.includes(theme.id)) expect(result.addedReducedMotion, theme.id).toBe(false);
    }
  });

  it("makes the nine stills of the interactive scenes pictures that do not move", () => {
    for (const id of STILLS) {
      const result = checkScene(sceneOf(id), `${id}.svg`);
      if (!result.ok) throw new Error(`${id} fails the gate: ${JSON.stringify(result.problem)}`);
      expect(result.cost.animated, id).toBe(0);
      // Nothing moves, so the rule that the gate adds to every scene is the only one there will be.
      expect(result.addedReducedMotion, id).toBe(true);
    }
  });

  it("gives each scene as a file whole, an svg that opens and closes, with no change of its own", () => {
    for (const theme of BUNDLED_THEMES) {
      const onDisk = readFileSync(join(DIR, theme.scene!), "utf8");
      expect(bundledSceneSvg(theme.id), theme.id).toBe(onDisk);
      expect(onDisk.startsWith("<svg "), theme.id).toBe(true);
      expect(onDisk.trimEnd().endsWith("</svg>"), theme.id).toBe(true);
      // The generator writes what `scene()` returns and adds nothing: no BOM, no line of its own before it. (Some
      // stills end in the newline their `scene()` ends in; it stays.)
      expect(onDisk.charCodeAt(0), theme.id).not.toBe(0xfeff);
      expect(onDisk, theme.id).not.toMatch(/^\s/);
    }
  });

  it("answers null for what is not in the gallery, whatever it is spelt like", () => {
    expect(bundledSceneSvg("no-such-theme")).toBeNull();
    expect(bundledSceneSvg("")).toBeNull();
    expect(bundledSceneSvg("../manifest")).toBeNull();
    expect(bundledSceneSvg("honu-lagoon.svg")).toBeNull();
    expect(bundledSceneSvg("HONU-LAGOON")).toBeNull();
    expect(bundledSceneSvg("__proto__")).toBeNull();
    expect(bundledSceneSvg("constructor")).toBeNull();
  });

  it("carries Claude Code's Apache-2.0 notice, with the version it was copied from", () => {
    const notice = readFileSync(join(DIR, "NOTICE.md"), "utf8");
    expect(notice).toContain("theme-examples");
    expect(notice).toContain("0.6.0");
    expect(notice).toContain("Apache License, Version 2.0");
    expect(notice).toContain("Anthropic");
    expect(notice).toMatch(/unchanged|without change|as they are/i);
  });
});
