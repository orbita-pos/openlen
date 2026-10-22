// @vitest-environment node
//
// Baking Tailwind reads stylesheets the model or the owner wrote. PostCSS loads the "previous" source map a
// stylesheet names in its `sourceMappingURL` comment, from the server's disk (GHSA-6g55-p6wh-862q,
// GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp): nothing here uses source maps, so none is ever loaded.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { generateTailwindCss } from "./tailwind-css";

describe("generateTailwindCss", () => {
  it("bakes the classes the page uses", async () => {
    const css = await generateTailwindCss('<p class="text-red-500">x</p>');
    expect(css).toContain(".text-red-500");
  });

  // Measured 21/10 with postcss 8.5.14: it loads the file into a new map and appends
  // `sourceMappingURL=to.css.map` to the CSS (the file's contents stay in the map, which nothing reads).
  it("🔴 never opens a source map a stylesheet points at on the server's disk", async () => {
    const map = join(mkdtempSync(join(tmpdir(), "openlen-map-")), "secret.map").replace(/\\/g, "/");
    writeFileSync(map, JSON.stringify({ version: 3, sources: ["a.css"], sourcesContent: ["SECRET-FROM-DISK"], mappings: "AAAA", names: [] }));
    const sheet = `.a { color: red }\n/*# sourceMappingURL=${map} */`;
    const css = await generateTailwindCss('<p class="a">x</p>', {}, [], [sheet]);
    expect(css).not.toContain("to.css.map");
    expect(css).not.toContain("SECRET-FROM-DISK");
  });
});
