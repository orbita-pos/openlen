// @vitest-environment node
//
// A TOOL FULL SCREEN ON AN EDGE-TO-EDGE ANDROID (final review of phase 5): the app draws under the system bars and gets
// their size as `--safe-area-inset-*` (SystemBars, insetsHandling "css"; estilos/app.css uses the same variables), so
// the tool's frame must stop above the navigation bar and below the status bar — otherwise the tool's own bottom
// buttons sit under the navigation bar — and must not flash white in dark mode while it loads.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "movil/src/herramientas/herramientas.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

describe("herramientas.css", () => {
  it("the screen keeps below the status bar with the app's own variable", () => {
    expect(rule(".herr-pantalla")).toContain("var(--safe-area-inset-top, env(safe-area-inset-top");
  });
  it("the tool's frame stops above the navigation bar", () => {
    expect(rule(".herr-cuerpo")).toContain("var(--safe-area-inset-bottom, env(safe-area-inset-bottom");
  });
  it("the frame doesn't flash white in dark mode", () => {
    expect(rule(".herr-cuerpo iframe")).not.toContain("#fff");
  });
});
