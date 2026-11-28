// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  READABLE,
  WORKSPACE_COLORS,
  contrastRatio,
  glassFit,
  glassInks,
  glassOpacityFor,
  paletteWarnings,
  parseRawColor,
} from "./contrast";

describe("contrastRatio", () => {
  it("is WCAG 2.x over sRGB: black on white is 21, a colour on itself is 1", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 2);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
    // The textbook pair: #777 on white is 4.48:1, just under AA.
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("reads every raw colour form Claude Code takes", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255 255 255)")).toBeCloseTo(21, 2);
    expect(contrastRatio("rgb(0% 0% 0%)", "hsl(0 0% 100%)")).toBeCloseTo(21, 2);
    expect(contrastRatio("hsla(0, 0%, 0%, 1)", "#ffffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#000f", "#ffff")).toBeCloseTo(21, 2);
    expect(parseRawColor("hsl(120 100% 25%)")).toMatchObject({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseRawColor("rgba(10, 20, 30, 50%)")).toMatchObject({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("flattens a translucent ink over its ground, and a translucent ground over white", () => {
    // 50% black over white is #808080: 3.95:1 against white.
    expect(contrastRatio("rgba(0,0,0,0.5)", "#ffffff")).toBeCloseTo(contrastRatio("#808080", "#ffffff"), 1);
    // A ground with alpha is read over white: a fully see-through one is white.
    expect(contrastRatio("#000000", "rgba(0,0,0,0)")).toBeCloseTo(21, 2);
  });

  it("refuses what is not a raw colour", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow();
    expect(() => contrastRatio("var(--fg)", "#fff")).toThrow();
  });
});

describe("glassOpacityFor", () => {
  it("raises the glass until dark text reads over the tint laid on what is under it", () => {
    const raised = glassOpacityFor({ fg: "#1a1a1a", tint: "#ffffff", under: "#000000", opacity: 0.4 });
    expect(raised).toBeGreaterThan(0.4);
    expect(raised).toBeLessThanOrEqual(0.95);
    // The ratio it promises, worked out the long way: tint over under, alpha-blended in sRGB, then fg on that.
    const channel = Math.round(255 * raised);
    const surface = `rgb(${channel}, ${channel}, ${channel})`;
    expect(contrastRatio("#1a1a1a", surface)).toBeGreaterThanOrEqual(READABLE - 0.05);
  });

  it("is the SMALLEST opacity on the 0.02 steps that reads", () => {
    const raised = glassOpacityFor({ fg: "#1a1a1a", tint: "#ffffff", under: "#000000", opacity: 0.4 });
    const below = Math.round((raised - 0.02) * 100) / 100;
    expect(glassFit({ fg: "#1a1a1a", tint: "#ffffff", under: "#000000", opacity: below }).opacity).toBe(raised);
    expect(glassFit({ fg: "#1a1a1a", tint: "#ffffff", under: "#000000", opacity: raised }).ratio).toBeGreaterThanOrEqual(READABLE);
    expect(raised * 100 % 2).toBeCloseTo(0, 6);
  });

  it("keeps the declared opacity when it already reads, and never lowers one", () => {
    expect(glassOpacityFor({ fg: "#000000", tint: "#ffffff", under: "#ffffff", opacity: 0.3 })).toBe(0.3);
    expect(glassOpacityFor({ fg: "#000000", tint: "#ffffff", under: "#ffffff", opacity: 0.77 })).toBe(0.77);
    // Light text on a dark tint over a dark scene reads at any opacity.
    expect(glassOpacityFor({ fg: "#f5f0f1", tint: "#0b0606", under: "#000000", opacity: 0.1 })).toBe(0.1);
  });

  it("stops at 0.95, and when nothing reads says the best it found", () => {
    // Mid-grey text on a mid-grey tint reads at no opacity at all.
    const fit = glassFit({ fg: "#808080", tint: "#7a7a7a", under: "#808080", opacity: 0.2 });
    expect(fit.opacity).toBeLessThanOrEqual(0.95);
    expect(fit.ratio).toBeLessThan(READABLE);
    // A declared opacity above the cap is left as it was.
    expect(glassOpacityFor({ fg: "#808080", tint: "#7a7a7a", under: "#808080", opacity: 0.98 })).toBe(0.98);
  });

  it("counts a tint's own alpha: a see-through tint lets the scene through at any opacity", () => {
    const solid = glassFit({ fg: "#1a1a1a", tint: "rgb(255 255 255)", under: "#000000", opacity: 0.4 });
    const faint = glassFit({ fg: "#1a1a1a", tint: "rgb(255 255 255 / 0.5)", under: "#000000", opacity: 0.4 });
    expect(faint.opacity).toBeGreaterThan(solid.opacity);
  });
});

describe("paletteWarnings", () => {
  it("reports the pairs of a palette that do not read, and none that do", () => {
    const warnings = paletteWarnings({
      id: "soft",
      window: "light",
      // fg a light grey on the workspace's light page: unreadable; muted is fine.
      colors: { "--fg": "#cccccc", "--fg-muted": "#444444" },
    });
    expect(warnings.every((w) => w.themeId === "soft" && w.code === "palette_pair")).toBe(true);
    expect(warnings.map((w) => `${w.fg}/${w.bg}`).sort()).toEqual(["--fg/--bg", "--fg/--bg-elev", "--fg/--bg-sidebar"]);
    expect(warnings[0]!.ratio).toBeLessThan(READABLE);
  });

  it("measures a theme's own background against the workspace's text for its window", () => {
    // A near-black page in the light window: the workspace's own dark ink (and its muted one) is lost on it. Only the
    // pairs that touch the theme's colour are reported, so the sidebar and the elevated surface say nothing here.
    const warnings = paletteWarnings({ id: "night", window: "light", colors: { "--bg": "#101010" } });
    expect(warnings.map((w) => `${w.fg}/${w.bg}`)).toEqual(["--fg/--bg", "--fg-muted/--bg"]);
  });

  it("says nothing of a pair neither side of which is the theme's", () => {
    expect(paletteWarnings({ id: "font-only", window: "light" })).toEqual([]);
    expect(paletteWarnings({ id: "accent", window: "dark", colors: { "--accent": "#ff00ff" } })).toEqual([]);
  });

  it("flattens a palette colour with alpha over the workspace's page", () => {
    const warnings = paletteWarnings({ id: "ghost", window: "light", colors: { "--fg": "rgba(0,0,0,0.05)" } });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ─── the workspace's own colours, pinned to the file they come from ──────────────────────────────────────────────────
//
// `tokens.css` writes its colours as oklch(); `contrastRatio` takes raw colours. So `WORKSPACE_COLORS` holds them as hex,
// converted ONCE from the file's oklch with the standard OKLab matrices and rounded to a byte — and this test converts
// the file again, on every run, and compares: change a colour in `tokens.css` and this goes red until the constant
// follows. One byte of slack per channel is the rounding.

function oklchToHex(body: string): string {
  const m = /^\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*$/.exec(body);
  if (!m) throw new Error(`not a plain oklch(L% C h): ${body}`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const gamma = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return `#${linear.map((c) => Math.round(gamma(c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function blockOf(css: string, selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1];
  if (block === undefined) throw new Error(`tokens.css has no block for ${selector}`);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*(--[a-z-]+):\s*oklch\(([^)]*)\)\s*;/gm)) out[m[1]!] = m[2]!;
  return out;
}

describe("WORKSPACE_COLORS", () => {
  const css = readFileSync(resolve(process.cwd(), "app/[locale]/new/tokens.css"), "utf8");
  const files = {
    light: blockOf(css, /^\.workspace-v2 \{([^}]*)\}/m),
    dark: blockOf(css, /^\.dark \.workspace-v2 \{([^}]*)\}/m),
  } as const;

  for (const window of ["light", "dark"] as const) {
    it(`is what tokens.css says for the ${window} window`, () => {
      const pinned = WORKSPACE_COLORS[window];
      expect(Object.keys(pinned).sort()).toEqual(["--bg", "--bg-elev", "--bg-sidebar", "--fg", "--fg-faint", "--fg-muted"]);
      for (const [token, hex] of Object.entries(pinned)) {
        const fromFile = files[window][token];
        expect(fromFile, `${token} in the ${window} block of tokens.css`).toBeDefined();
        const want = parseRawColor(oklchToHex(fromFile!));
        const got = parseRawColor(hex);
        for (const channel of ["r", "g", "b"] as const) expect(Math.abs(got[channel] - want[channel]), `${window} ${token} ${channel}`).toBeLessThanOrEqual(1);
      }
    });
  }

  it("reads in both windows: the workspace's own text on its own page is above 4.5", () => {
    for (const window of ["light", "dark"] as const) {
      const c = WORKSPACE_COLORS[window];
      for (const bg of ["--bg", "--bg-sidebar", "--bg-elev"] as const) {
        expect(contrastRatio(c["--fg"], c[bg])).toBeGreaterThanOrEqual(READABLE);
        expect(contrastRatio(c["--fg-muted"], c[bg])).toBeGreaterThanOrEqual(READABLE);
        expect(contrastRatio(c["--fg-faint"], c[bg])).toBeGreaterThanOrEqual(READABLE);
      }
    }
  });
});

describe("glassFit with every ink of the panel", () => {
  it("is raised for the STRICTEST ink, and says which one is weakest", () => {
    const alone = glassFit({ fg: "#000000", tint: "#ffffff", under: "#808080", opacity: 0.3 });
    const both = glassFit({ fg: ["#000000", "#6b6b6b"], tint: "#ffffff", under: "#808080", opacity: 0.3 });
    expect(alone.opacity).toBe(0.3);
    expect(both.opacity).toBeGreaterThan(0.3);
    expect(both.ink).toBe(1);
    expect(both.ratio).toBeGreaterThanOrEqual(READABLE);
    // The weakest ink at the returned opacity reads; so does every other.
    const channel = Math.round(255 * both.opacity + 128 * (1 - both.opacity));
    expect(contrastRatio("#6b6b6b", `rgb(${channel}, ${channel}, ${channel})`)).toBeGreaterThanOrEqual(READABLE - 0.05);
  });

  it("glassInks hands over --fg, --fg-muted and --fg-faint, the theme's own where it has them", () => {
    expect(glassInks({ window: "light" }, {}).fg).toEqual([WORKSPACE_COLORS.light["--fg"], WORKSPACE_COLORS.light["--fg-muted"], WORKSPACE_COLORS.light["--fg-faint"]]);
    expect(glassInks({ window: "dark", colors: { "--fg-muted": "#aaaaaa" } }, { tint: "#000000" })).toEqual({
      fg: [WORKSPACE_COLORS.dark["--fg"], "#aaaaaa", WORKSPACE_COLORS.dark["--fg-faint"]],
      tint: "#000000",
    });
  });
});
