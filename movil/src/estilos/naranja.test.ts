// @vitest-environment node
// THE APP TAKES HER COLOR (spec local 2026-11-16-movil-es-tu-asistente, §5.2): Len's orange lives only as the fallback
// of her variables (`var(--her-…, <orange>)`), so the app is orange before signing in and with no assistant, and hers
// otherwise. A loose orange would stay orange in a blue app.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ORANGES = /#(FF8A1E|F26A0F|FFB23E|DD5210|B93F08|FFB25C|CF4808|C7460A)\b|255,\s*138,\s*30|242,\s*106,\s*15/i;
const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const withoutFallbacks = (css: string) => css.replace(/var\(--her-[a-z-]+,[^)]*\)/g, "");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [path.relative(process.cwd(), p)] : [];
  });
}

describe("Len's orange in the phone's styles", () => {
  for (const f of ["movil/src/estilos/prototipo.css", "movil/src/estilos/app.css"]) {
    it(`🔴 ${f}: no orange left outside the fallbacks of her variables`, () => {
      const left = withoutFallbacks(read(f)).split("\n").filter((l) => ORANGES.test(l));
      expect(left).toEqual([]);
    });
  }

  it("🔴 text on her bubble color is her ink, never a fixed white", () => {
    const fixed = cssFiles("movil/src").flatMap((f) =>
      read(f)
        .split("}")
        .filter((rule) => /background:\s*var\(--c-me\)/.test(rule) && /(^|[;{\s])color:\s*#fff\b/i.test(rule))
        .map((rule) => `${f}: ${rule.trim().slice(0, 80)}`),
    );
    expect(fixed).toEqual([]);
  });
});
