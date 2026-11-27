// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readThemeManifest } from "./manifest";
import { isRawColor } from "./raw-color";
import { THEME_TOKENS, type ThemeDefinition } from "./types";

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><rect width="1600" height="1000"/></svg>`;

// The spec's example (§4.1): a pond, in a light window and a dark one.
const POND = {
  id: "estanque",
  window: "light",
  twin: "estanque-noche",
  glass: { blur: 10, tint: "#eef8f1", opacity: 0.38 },
  scene: "/themes/estanque.svg",
};
const POND_NIGHT = {
  id: "estanque-noche",
  window: "dark",
  twin: "estanque",
  glass: { blur: 10, tint: "#0c1a14", opacity: 0.45 },
  scene: "/themes/estanque-noche.svg",
};

type Files = Record<string, string>;

const pkg = (themes: unknown) =>
  JSON.stringify({ name: "estanque", version: "1.0.0", private: true, openlen: { theme: { themes } } });

const locale = (ids: string[], tag: string) =>
  JSON.stringify({ themes: Object.fromEntries(ids.map((id) => [id, { title: `${tag} ${id}`, blurb: `${tag} blurb of ${id}` }])) });

/** A project with these themes, their locale files for `en` and `es`, and a scene file for each `scene` they name. */
function project(themes: Record<string, unknown>[], over: Record<string, string | undefined> = {}): Files {
  const ids = themes.map((t) => String(t.id));
  const files: Record<string, string | undefined> = {
    "/package.json": pkg(themes),
    "/locale/en.json": locale(ids, "en"),
    "/locale/es.json": locale(ids, "es"),
    ...Object.fromEntries(themes.filter((t) => typeof t.scene === "string").map((t) => [t.scene as string, SCENE])),
    ...over,
  };
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== undefined));
}

const read = (files: Files, personLocale = "es") => readThemeManifest(files, { personLocale });

const codes = (files: Files, personLocale = "es"): string[] => {
  const r = read(files, personLocale);
  return r.ok ? [] : r.problems.map((p) => p.code);
};

/** The themes of a manifest that must be valid: it fails loudly, so a refusal can't pass as a `false` or an `undefined`. */
const themesOf = (files: Files, personLocale = "es"): ThemeDefinition[] => {
  const r = read(files, personLocale);
  if (!r.ok) throw new Error(`expected a valid manifest, got ${JSON.stringify(r.problems)}`);
  return r.themes;
};

/** One theme with only a ground, so a test can vary the ground alone. */
const grounded = (ground: unknown, extra: Record<string, unknown> = {}) =>
  project([{ id: "suelo", window: "dark", ground, ...extra }]);

describe("readThemeManifest", () => {
  it("accepts the spec's pond pair", () => {
    const themes = themesOf(project([POND, POND_NIGHT]));
    expect(themes).toHaveLength(2);
    expect(themes[0]!.glass).toEqual({ blur: 10, tint: "#eef8f1", opacity: 0.38 });
    expect(themes[0]).toEqual({
      id: "estanque",
      window: "light",
      twin: "estanque-noche",
      scene: "/themes/estanque.svg",
      glass: { blur: 10, tint: "#eef8f1", opacity: 0.38 },
      titles: { en: "en estanque", es: "es estanque" },
      blurbs: { en: "en blurb of estanque", es: "es blurb of estanque" },
    });
    expect(themes[1]!.window).toBe("dark");
  });

  it("reads `null` as absent, as Claude Code does", () => {
    const themes = themesOf(project([{ ...POND, twin: null, glass: null, ground: null, colors: null, font: null }]));
    expect(themes[0]).toEqual({
      id: "estanque",
      window: "light",
      scene: "/themes/estanque.svg",
      glass: { blur: 16, opacity: 0.6 },
      titles: { en: "en estanque", es: "es estanque" },
      blurbs: { en: "en blurb of estanque", es: "es blurb of estanque" },
    });
  });

  describe("the glass, with Claude Code's limits", () => {
    it("fills Claude Code's default glass for a scene that names none", () => {
      const themes = themesOf(project([{ id: "sola", window: "light", scene: "/themes/sola.svg" }]));
      expect(themes[0]!.glass).toEqual({ blur: 16, opacity: 0.6 });
    });

    it("fills only what is missing, and keeps `glass: false` as it is", () => {
      const half = themesOf(project([{ id: "a", window: "light", scene: "/a.svg", glass: { blur: 4 } }]));
      expect(half[0]!.glass).toEqual({ blur: 4, opacity: 0.6 });
      const none = themesOf(project([{ id: "b", window: "light", scene: "/b.svg", glass: false }]));
      expect(none[0]!.glass).toBe(false);
    });

    it("accepts the edges: blur 0 and 64, opacity 0 and 1", () => {
      expect(themesOf(project([{ id: "a", window: "light", scene: "/a.svg", glass: { blur: 0, opacity: 0 } }]))[0]!.glass).toEqual({ blur: 0, opacity: 0 });
      expect(themesOf(project([{ id: "b", window: "light", scene: "/b.svg", glass: { blur: 64, opacity: 1 } }]))[0]!.glass).toEqual({ blur: 64, opacity: 1 });
    });

    it("refuses blur 65, opacity 1.2 and tint \"red\"", () => {
      const glassOf = (glass: unknown) => project([{ id: "x", window: "light", scene: "/x.svg", glass }]);
      expect(codes(glassOf({ blur: 65 }))).toEqual(["glass_blur"]);
      expect(codes(glassOf({ blur: -1 }))).toEqual(["glass_blur"]);
      expect(codes(glassOf({ blur: "10" }))).toEqual(["glass_blur"]);
      expect(codes(glassOf({ opacity: 1.2 }))).toEqual(["glass_opacity"]);
      expect(codes(glassOf({ opacity: -0.1 }))).toEqual(["glass_opacity"]);
      expect(codes(glassOf({ tint: "red" }))).toEqual(["glass_tint"]);
      expect(codes(glassOf({ tint: "var(--bg)" }))).toEqual(["glass_tint"]);
    });

    it("refuses a glass that is neither an object nor false", () => {
      expect(codes(project([{ id: "x", window: "light", scene: "/x.svg", glass: true }]))).toEqual(["glass_shape"]);
      expect(codes(project([{ id: "x", window: "light", scene: "/x.svg", glass: [] }]))).toEqual(["glass_shape"]);
    });

    it("refuses glass on a still ground, and glass with nothing to see through", () => {
      expect(codes(grounded({ color: "#101820" }, { glass: { blur: 8 } }))).toEqual(["glass_on_ground"]);
      expect(codes(grounded({ color: "#101820" }, { glass: false }))).toEqual(["glass_on_ground"]);
      expect(codes(project([{ id: "c", window: "dark", colors: { "--fg": "#fff" }, glass: { blur: 8 } }]))).toEqual(["glass_no_scene"]);
    });

    it("gives a still ground and a palette-only theme no glass at all", () => {
      expect("glass" in themesOf(grounded({ color: "#101820" }))[0]!).toBe(false);
      expect("glass" in themesOf(project([{ id: "c", window: "dark", colors: { "--fg": "#fff" } }]))[0]!).toBe(false);
    });
  });

  describe("the still ground", () => {
    it("reads the three kinds as Claude Code writes them, in the shape the layer paints", () => {
      expect(themesOf(grounded({ color: "#101820" }))[0]!.ground).toEqual({ color: "#101820" });

      const gradient = themesOf(
        grounded({
          gradient: { stops: ["#112233", { at: 0.6, color: "rgb(10 20 30)" }, "#445566"], angle: 45, size: [24, 8], repeat: true },
        }),
      );
      expect(gradient[0]!.ground).toEqual({
        gradient: {
          stops: [
            { color: "#112233", at: 0 },
            { color: "rgb(10 20 30)", at: 0.6 },
            { color: "#445566", at: 1 },
          ],
          angle: 45,
          size: "24px 8px",
          repeat: true,
        },
      });

      const radial = themesOf(grounded({ gradient: { stops: ["#112233", "#445566"], shape: "radial" } }));
      expect(radial[0]!.ground).toEqual({ gradient: { stops: [{ color: "#112233" }, { color: "#445566" }], shape: "radial" } });

      const vector = themesOf(
        grounded({
          vector: {
            viewBox: [24, 12],
            paths: ["M0 0L24 12H0Z", { d: "M2 2l4 4", color: "#fff", strokeWidth: 1.5 }],
            color: "#334455",
            size: [48, 24],
            repeat: true,
          },
        }),
      );
      expect(vector[0]!.ground).toEqual({
        vector: {
          viewBox: "0 0 24 12",
          paths: [{ d: "M0 0L24 12H0Z" }, { d: "M2 2l4 4", color: "#fff", strokeWidth: 1.5 }],
          color: "#334455",
          size: "48px 24px",
          repeat: true,
        },
      });

      const square = themesOf(grounded({ vector: { viewBox: 32, paths: ["M0 0L32 32"], color: "#334455" } }));
      expect(square[0]!.ground).toEqual({ vector: { viewBox: "0 0 32 32", paths: [{ d: "M0 0L32 32" }], color: "#334455" } });
    });

    it("refuses two grounds, a scene with a ground, and a ground that is none", () => {
      expect(codes(grounded({ color: "#101820", gradient: { stops: ["#000", "#fff"] } }))).toEqual(["ground_many"]);
      expect(codes(project([{ id: "x", window: "dark", scene: "/x.svg", ground: { color: "#101820" } }]))).toEqual(["ground_many"]);
      expect(codes(grounded({}))).toEqual(["ground_bad"]);
      expect(codes(grounded("#101820"))).toEqual(["ground_bad"]);
    });

    it("refuses an image ground: redraw the picture as SVG", () => {
      expect(codes(grounded({ image: { source: "/img/bg.png" } }))).toEqual(["ground_image"]);
      expect(codes(grounded({ color: "#101820", image: "x" }))).toEqual(["ground_image"]);
    });

    it("refuses what would reach the stylesheet as something other than a number or a raw colour", () => {
      const bad = (ground: unknown) => codes(grounded(ground));
      expect(bad({ color: "red" })).toEqual(["ground_value"]);
      expect(bad({ color: "var(--fg)" })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000"] } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000", "url(https://example.com/x.png)"] } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: [{ at: 0.8, color: "#000" }, { at: 0.2, color: "#fff" }] } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: [{ at: 2, color: "#000" }, "#fff"] } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000", "#fff"], angle: 400 } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000", "#fff"], shape: "conic" } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000", "#fff"], size: [0, 8] } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000", "#fff"], size: "24px" } })).toEqual(["ground_value"]);
      expect(bad({ gradient: { stops: ["#000", "#fff"], repeat: "yes" } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: "0 0 24 24", paths: ["M0 0L1 1"], color: "#fff" } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: 24, paths: [], color: "#fff" } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: 24, paths: ["M0 0L1 1"] } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: 24, paths: ["alert(1)"], color: "#fff" } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: 24, paths: ["M0 0L9999999 1"], color: "#fff" } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: 24, paths: ["M0 0" + "L1 1".repeat(5000)], color: "#fff" } })).toEqual(["ground_value"]);
      expect(bad({ vector: { viewBox: 24, paths: [{ d: "M0 0L1 1", strokeWidth: 0 }], color: "#fff" } })).toEqual(["ground_value"]);
    });

    it("counts what Claude Code counts: 2 to 16 stops, 1 to 64 paths, at most 480 values in all", () => {
      const stops = (n: number) => Array.from({ length: n }, () => "#000");
      const paths = (n: number) => Array.from({ length: n }, () => ({ d: "M0 0L1 1", color: "#fff" }));
      expect(codes(grounded({ gradient: { stops: stops(16) } }))).toEqual([]);
      expect(codes(grounded({ gradient: { stops: stops(17) } }))).toEqual(["ground_value"]);
      expect(codes(grounded({ vector: { viewBox: 24, paths: paths(64) } }))).toEqual([]);
      expect(codes(grounded({ vector: { viewBox: 24, paths: paths(65) } }))).toEqual(["ground_value"]);
      expect(codes(grounded({ vector: { viewBox: 24, paths: paths(192) } }))).toEqual(["ground_too_big"]);
      const deep = (n: number): unknown => (n === 0 ? "#000" : { x: deep(n - 1) });
      expect(codes(grounded({ color: "#000", note: deep(400) }))).toEqual(["ground_too_big"]);
    });
  });

  describe("the twin", () => {
    it("refuses a twin that is missing or of the same window", () => {
      expect(codes(project([{ ...POND, twin: "nadie" }]))).toEqual(["twin_missing"]);
      expect(codes(project([{ ...POND, twin: 7 }]))).toEqual(["twin_missing"]);
      expect(codes(project([POND, { ...POND_NIGHT, window: "light" }]))).toContain("twin_same_window");
      expect(codes(project([{ ...POND, twin: "estanque" }]))).toEqual(["twin_same_window"]);
    });
  });

  describe("the palette and the font", () => {
    it("accepts every name in THEME_TOKENS with a raw colour", () => {
      const colors = Object.fromEntries(THEME_TOKENS.map((t) => [t, "rgba(10, 20, 30, 0.5)"]));
      expect(themesOf(project([{ id: "paleta", window: "dark", colors }]))[0]!.colors).toEqual(colors);
    });

    it("refuses a palette key outside THEME_TOKENS", () => {
      expect(codes(project([{ id: "x", window: "dark", colors: { "--x": "#fff" } }]))).toEqual(["colors_key"]);
      expect(codes(project([{ id: "x", window: "dark", colors: { fg: "#fff" } }]))).toEqual(["colors_key"]);
      // JSON.parse makes `__proto__` an own key: it is a name outside the list like any other.
      const files = project([{ id: "x", window: "dark" }], {
        "/package.json": `{"openlen":{"theme":{"themes":[{"id":"x","window":"dark","colors":{"__proto__":"#fff"}}]}}}`,
      });
      expect(codes(files)).toEqual(["colors_key"]);
    });

    it("refuses a palette value that is not a raw colour", () => {
      expect(codes(project([{ id: "x", window: "dark", colors: { "--fg": "var(--fg)" } }]))).toEqual(["colors_value"]);
      expect(codes(project([{ id: "x", window: "dark", colors: { "--fg": "oklch(50% 0.1 12)" } }]))).toEqual(["colors_value"]);
      expect(codes(project([{ id: "x", window: "dark", colors: { "--fg": 12 } }]))).toEqual(["colors_value"]);
    });

    it("refuses a palette that is not an object", () => {
      expect(codes(project([{ id: "x", window: "dark", colors: ["#fff"] }]))).toEqual(["colors_shape"]);
    });

    it("accepts one generic font and refuses \"Comic Sans\"", () => {
      for (const font of ["sans", "serif", "mono", "code", "cursive"]) {
        expect(themesOf(project([{ id: "f", window: "dark", colors: { "--fg": "#fff" }, font }]))[0]!.font).toBe(font);
      }
      expect(codes(project([{ id: "f", window: "dark", colors: { "--fg": "#fff" }, font: "Comic Sans" }]))).toEqual(["font"]);
      expect(codes(project([{ id: "f", window: "dark", colors: { "--fg": "#fff" }, font: ["serif"] }]))).toEqual(["font"]);
    });

    it("keeps THEME_TOKENS to names the workspace stylesheet defines", () => {
      const css = readFileSync(resolve(process.cwd(), "app/[locale]/new/tokens.css"), "utf8");
      for (const token of THEME_TOKENS) expect(css, token).toMatch(new RegExp(`^\\s*${token}\\s*:`, "m"));
    });
  });

  describe("what a theme says about itself", () => {
    it("refuses a theme id that is not a short lower-case slug", () => {
      expect(codes(project([{ ...POND, id: "Estanque!", twin: undefined }]))).toEqual(["bad_id"]);
      expect(codes(project([{ ...POND, id: "_estanque", twin: undefined }]))).toEqual(["bad_id"]);
      expect(codes(project([{ ...POND, id: "a".repeat(65), twin: undefined }]))).toEqual(["bad_id"]);
      expect(codes(project([{ ...POND, id: 7, twin: undefined }]))).toEqual(["bad_id"]);
      const longest = "a".repeat(64);
      const short = JSON.stringify({ themes: { [longest]: { title: "T", blurb: "B" } } });
      const files = project([{ ...POND, id: longest, twin: undefined }], { "/locale/en.json": short, "/locale/es.json": short });
      expect(themesOf(files)).toHaveLength(1);
    });

    it("refuses two themes with the same id, and a window that is neither light nor dark", () => {
      expect(codes(project([{ ...POND, twin: undefined }, { ...POND_NIGHT, id: "estanque", twin: undefined }]))).toEqual(["duplicate_id"]);
      expect(codes(project([{ ...POND, window: "sepia", twin: undefined }]))).toEqual(["bad_window"]);
    });

    it("requires English and the person's locale for the title and the blurb", () => {
      const noSpanish = project([POND, POND_NIGHT], { "/locale/es.json": undefined });
      const r = read(noSpanish, "es");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.problems.map((p) => p.code)).toEqual(["missing_meta", "missing_meta", "missing_meta", "missing_meta"]);
        expect(r.problems.every((p) => p.file === "/locale/es.json")).toBe(true);
        expect(r.problems.map((p) => p.detail)).toContain("estanque.blurb");
      }
      // The same files are fine for someone whose locale is English: only English is required then.
      expect(themesOf(noSpanish, "en")).toHaveLength(2);
      // No English at all.
      expect(codes(project([POND, POND_NIGHT], { "/locale/en.json": undefined }), "es")).toContain("missing_meta");
      // A title without its blurb.
      const half = JSON.stringify({ themes: { estanque: { title: "Pond" }, "estanque-noche": { title: "Night pond", blurb: "b" } } });
      expect(codes(project([POND, POND_NIGHT], { "/locale/en.json": half }))).toEqual(["missing_meta"]);
    });

    it("reads the title and blurb of every locale file present, not only the two required", () => {
      const fr = JSON.stringify({ themes: { estanque: { title: "Étang", blurb: "Un étang." }, "estanque-noche": { title: "Étang de nuit", blurb: "La nuit." } } });
      const themes = themesOf(project([POND, POND_NIGHT], { "/locale/fr.json": fr }));
      expect(themes[0]!.titles).toEqual({ en: "en estanque", es: "es estanque", fr: "Étang" });
      expect(themes[0]!.blurbs.fr).toBe("Un étang.");
    });

    it("refuses a title or a blurb too long for a card", () => {
      const long = JSON.stringify({ themes: { estanque: { title: "x".repeat(61), blurb: "ok" }, "estanque-noche": { title: "ok", blurb: "x".repeat(201) } } });
      expect(codes(project([POND, POND_NIGHT], { "/locale/en.json": long }))).toEqual(["meta_too_long", "meta_too_long"]);
    });
  });

  describe("what a theme is made of", () => {
    it("refuses a scene path that is missing, naming the file", () => {
      const r = read(project([{ id: "x", window: "light", scene: "/themes/x.svg" }], { "/themes/x.svg": undefined }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems).toEqual([{ code: "scene_missing", file: "/themes/x.svg", detail: "x" }]);
    });

    it("refuses a scene that is not a path to an svg inside the project", () => {
      for (const scene of ["themes/x.svg", "/themes/../x.svg", "/themes/x.png", "https://example.com/x.svg", "/themes//x.svg", 7]) {
        expect(codes(project([{ id: "x", window: "light", scene }])), String(scene)).toEqual(["scene_path"]);
      }
    });

    it("refuses a theme with neither scene nor ground nor colors", () => {
      expect(codes(project([{ id: "vacio", window: "light" }]))).toEqual(["empty_theme"]);
      expect(codes(project([{ id: "vacio", window: "light", colors: {} }]))).toEqual(["empty_theme"]);
      expect(codes(project([{ id: "vacio", window: "light", font: "serif" }]))).toEqual(["empty_theme"]);
    });

    it("accepts a theme that is only a palette", () => {
      const themes = themesOf(project([{ id: "tinta", window: "light", colors: { "--fg": "#111111", "--accent": "hsl(12, 90%, 55%)" } }]));
      expect(themes[0]!.colors).toEqual({ "--fg": "#111111", "--accent": "hsl(12, 90%, 55%)" });
    });

    it("reports every problem, not just the first", () => {
      const files = project([{ id: "x", window: "light", scene: "/x.svg", glass: { blur: 65, opacity: 2 }, font: "Comic Sans" }]);
      expect(codes(files)).toEqual(["glass_blur", "glass_opacity", "font"]);
    });
  });

  describe("the package", () => {
    it("no package.json, or not JSON", () => {
      expect(codes(project([POND, POND_NIGHT], { "/package.json": undefined }))).toEqual(["no_package_json"]);
      expect(codes(project([POND, POND_NIGHT], { "/package.json": "{nope" }))).toEqual(["bad_json"]);
      expect(codes(project([POND, POND_NIGHT], { "/package.json": "[]" }))).toEqual(["bad_json"]);
    });

    it("themes missing, empty, not a list, a list of non-objects, or more than 64", () => {
      const withThemes = (themes: unknown) => project([POND], { "/package.json": pkg(themes) });
      expect(codes(project([POND], { "/package.json": JSON.stringify({ name: "x" }) }))).toEqual(["no_themes"]);
      expect(codes(withThemes([]))).toEqual(["no_themes"]);
      expect(codes(withThemes({ estanque: POND }))).toEqual(["no_themes"]);
      expect(codes(withThemes(["estanque"]))).toEqual(["bad_theme"]);

      const many = Array.from({ length: 65 }, (_, i) => ({ id: `t${i}`, window: "light", colors: { "--fg": "#111" } }));
      expect(codes(project(many))).toEqual(["too_many_themes"]);
      expect(themesOf(project(many.slice(0, 64)))).toHaveLength(64);
    });
  });
});

describe("isRawColor", () => {
  it("accepts #hex, rgb(), rgba(), hsl() and hsla() of numbers", () => {
    for (const c of [
      "#eef8f1",
      "#fff",
      "#ffff",
      "#12345678",
      "rgb(10, 20, 30)",
      "rgb(10 20 30)",
      "rgba(10 20 30 / .5)",
      "rgba(10,20,30,0.5)",
      "hsl(120, 50%, 40%)",
      "hsla(120 50% 40% / 40%)",
    ]) {
      expect(isRawColor(c), c).toBe(true);
    }
  });

  it("refuses names, functions that are not colours, CSS variables and anything that is not a number", () => {
    for (const c of [
      "red",
      "transparent",
      "#12",
      "#12345",
      "#ggg",
      "rgb(1, 2)",
      "rgb(1, 2, 3, 4, 5)",
      "rgb(a, b, c)",
      "oklch(50% 0.1 12)",
      "var(--fg)",
      "url(https://example.com/x.png)",
      "rgb(1,2,3);color:red",
      "rgb(1,2,3) ",
      " #fff",
      "",
    ]) {
      expect(isRawColor(c), c).toBe(false);
    }
    for (const v of [undefined, null, 12, {}, ["#fff"]]) expect(isRawColor(v)).toBe(false);
  });

  it("is at most 64 characters, even where the pattern would take more", () => {
    const fits = `rgb(1,${" ".repeat(27)}2,${" ".repeat(27)}3)`;
    const tooLong = `rgb(1,${" ".repeat(28)}2,${" ".repeat(28)}3)`;
    expect(fits).toHaveLength(64);
    expect(tooLong).toHaveLength(66);
    expect(isRawColor(fits)).toBe(true);
    expect(isRawColor(tooLong)).toBe(false);
  });
});
