// @vitest-environment node
//
// THE WORKSPACE'S COLOURS, FOR A TOOL OUTSIDE THE WORKSPACE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4,
// §4.14): the phone app gives a tool the same tokens the workspace paints with, light or dark. They are copied, so
// this test reads tokens.css and fails the day one of them changes there and not here.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TOOL_THEME_TOKENS } from "./protocol";
import { WORKSPACE_TOOL_THEME } from "./workspace-theme";

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const css = readFileSync(path.join(process.cwd(), "app/[locale]/new/tokens.css"), "utf8");
const light = block(css, ".workspace-v2");
const dark = { ...light, ...block(css, ".dark .workspace-v2") };
const NAMES = TOOL_THEME_TOKENS.filter((n) => n !== "--font-sans");

describe("WORKSPACE_TOOL_THEME", () => {
  it("light: every tool token as tokens.css paints it", () => {
    for (const n of NAMES) expect([n, WORKSPACE_TOOL_THEME.light[n]]).toEqual([n, light[n]]);
  });
  it("dark: what .dark overrides, the rest as light", () => {
    for (const n of NAMES) expect([n, WORKSPACE_TOOL_THEME.dark[n]]).toEqual([n, dark[n]]);
  });
});
