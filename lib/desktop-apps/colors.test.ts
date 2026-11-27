// @vitest-environment node
//
// THE WINDOW'S COLOURS (spec local 2026-11-26-apps-en-el-escritorio, §4.3): the browser reads the manifest's and the tab's colours
// with its own parser, where oklch is not safe, so they are hex — copied, in ONE place (`colors.ts`), from the workspace's
// tokens. This test reads tokens.css and fails the day one of them moves there and not here, so the title bar, the splash and the
// strip are one band, light and dark, as Claude's window follows the system (`#fcfcfb` / `#151515`).
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { oklchToLinearRgb, parseOklch } from "@/lib/design/color";

import { DESKTOP_COLORS } from "./colors";
import { DESKTOP_BACKGROUND_COLOR, DESKTOP_THEME_COLOR } from "./manifest";

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const encode = (linear: number) => {
  const x = Math.max(0, Math.min(1, linear));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};
/** An oklch() token as the hex a browser would paint (sRGB, rounded). */
function hexOf(oklch: string): string {
  const c = parseOklch(oklch);
  if (!c) throw new Error(`not an oklch colour: ${oklch}`);
  return `#${oklchToLinearRgb(c.L, c.C, c.H)
    .map((v) => Math.round(encode(v) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

const css = readFileSync(path.join(process.cwd(), "app/[locale]/new/tokens.css"), "utf8");
const light = block(css, ".workspace-v2");
const dark = { ...light, ...block(css, ".dark .workspace-v2") };

describe("DESKTOP_COLORS — the workspace's tokens, as hex", () => {
  it("light: the page behind the window (--bg) and the strip's band (--bg-elev)", () => {
    expect(DESKTOP_COLORS.light).toEqual({ background: hexOf(light["--bg"]!), theme: hexOf(light["--bg-elev"]!) });
  });

  it("dark: the same two, as `.dark` paints them", () => {
    expect(DESKTOP_COLORS.dark).toEqual({ background: hexOf(dark["--bg"]!), theme: hexOf(dark["--bg-elev"]!) });
  });

  it("they are hex and the two modes are not the same colour", () => {
    for (const mode of ["light", "dark"] as const) for (const hex of Object.values(DESKTOP_COLORS[mode])) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(DESKTOP_COLORS.dark.theme).not.toBe(DESKTOP_COLORS.light.theme);
    expect(DESKTOP_COLORS.dark.background).not.toBe(DESKTOP_COLORS.light.background);
  });

  it("the manifest's colours are the light pair from here, not a second copy", () => {
    expect(DESKTOP_BACKGROUND_COLOR).toBe(DESKTOP_COLORS.light.background);
    expect(DESKTOP_THEME_COLOR).toBe(DESKTOP_COLORS.light.theme);
  });
});
