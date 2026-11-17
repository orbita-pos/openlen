// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { mix } from "@/lib/figure/look";
import { contrast, tintOf } from "@/lib/figure/tint";

import { HER_VARS, applyHerColor, herColorVars } from "./color";

/** The phone's dark panel (prototipo.css `--lm-panel` in dark). */
const DARK_PANEL = "#1e140e";

describe("her color, as the app's (spec local 2026-11-16-movil-es-tu-asistente, §5.2)", () => {
  it("computes her variables from her color", () => {
    const v = herColorVars("#3b82f6")!;
    const t = tintOf("#3b82f6")!;
    expect(v["--her-tint"]).toBe(t.tint);
    expect(v["--her-ink"]).toBe(t.ink);
    expect(v["--her-soft"]).toBe(t.soft);
    expect(v["--her-soft-dark"]).toBe(t.softDark);
    expect(v["--her-tint-a"]).toBe(mix(t.tint, "#ffffff", 0.25));
    expect(v["--her-tint-c"]).toBe(mix(t.tint, "#000000", 0.12));
    expect(v["--her-paper"]).toBe(mix("#3b82f6", "#ffffff", 0.95));
    expect(v["--her-paper-dark"]).toBe(mix("#3b82f6", "#000000", 0.92));
    expect(v["--her-me"]).toBe(t.tint);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.tint.slice(i, i + 2), 16));
    expect(v["--her-rgb"]).toBe(`${r},${g},${b}`);
  });

  it("🔴 the ink reads over her color, and her accent text reads on both themes, whatever color she is", () => {
    for (const c of ["#ffffff", "#000000", "#808080", "#ffff00", "#3b82f6", "#f4a48b"]) {
      const v = herColorVars(c)!;
      expect(contrast(v["--her-tint"], v["--her-ink"]), c).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--her-deep"], "#ffffff"), c).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--her-light"], DARK_PANEL), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("not a color: nothing", () => {
    expect(herColorVars("blue")).toBeNull();
  });

  it("applying her color sets every variable; null takes them all off, and the orange is back", () => {
    const root = document.createElement("div");
    applyHerColor("#3b82f6", root);
    for (const name of HER_VARS) expect(root.style.getPropertyValue(name), name).not.toBe("");
    applyHerColor(null, root);
    for (const name of HER_VARS) expect(root.style.getPropertyValue(name), name).toBe("");
  });
});
