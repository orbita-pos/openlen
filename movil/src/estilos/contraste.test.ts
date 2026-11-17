// @vitest-environment node
// TEXT THAT READS ON HER COLOR (final review, I5; spec local 2026-11-16-movil-es-tu-asistente, §5.2). Her brand sheet is
// her color with its computed ink (--m-ink, --m-dim); a fixed muted brown there reads at ~1.5:1 on a mid blue. And the
// welcome paints its own cream: a button that inherits the sheet's white ink disappears on it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const rule = (css: string, selector: string) => {
  const compacto = css.indexOf(selector + "{");
  const at = compacto >= 0 ? compacto : css.indexOf(selector + " {");
  if (at < 0) return null;
  return css.slice(at, css.indexOf("}", at) + 1);
};

describe("text over her color", () => {
  it("la asignación del proyecto tiene un fondo propio y texto legible", () => {
    const r = rule(read("movil/src/estilos/app.css"), ".app-hoja-junto");
    expect(r).not.toBeNull();
    expect(r).toContain("color: var(--lm-ink)");
    expect(r).toContain("background: var(--lm-panel)");
  });

  it("🔴 the welcome's «Ahora no» carries its own ink and ground, never the sheet's white", () => {
    const r = rule(read("movil/src/asistente/welcome-creator.css"), ".welcome-foot .lm-btn.lm-sec");
    expect(r).not.toBeNull();
    expect(r).toContain("color:var(--lm-ink)");
    expect(r).toContain("background:var(--lm-panel)");
  });
});
