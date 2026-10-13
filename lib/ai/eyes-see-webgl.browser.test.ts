// @vitest-environment node
//
// LEN'S EYES SEE WEBGL: three.js, a 3D map, a game. With the Chromium from
// `lanzarChromium` —the one behind `view_page`, `use_page` and `npm test`— and
// looking at what Len looks at, the SCREENSHOT, not just whether the context exists.
//
// MEASURED on 2026-10-13 on the production box (Chrome 148, no GPU): with bare
// `--disable-gpu`, `getContext("webgl")` and `"webgl2"` returned null, and a
// three.js scene looked black. With `--enable-unsafe-swiftshader` WebGL runs in
// software (ANGLE over SwiftShader) and the pixel comes out red.
import { describe, expect, it } from "vitest";
import { lanzarChromium } from "./visual-quality-renderer";
import { decodificarPng, leerPixel } from "./png-crudo";

const PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="200" height="200" style="display:block"></canvas>
<script>
  const gl = document.getElementById("c").getContext("webgl");
  window.__gl = gl ? "ok" : "null";
  function paint() { gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(paint); }
  if (gl) paint();
</script></body></html>`;

describe("Len's eyes", () => {
  it("🔴 see a WebGL scene in the screenshot", async () => {
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 200, height: 200 });
      await page.setContent(PAGE, { waitUntil: "load" });
      await new Promise((r) => setTimeout(r, 300));
      expect(await page.evaluate("window.__gl"), "getContext('webgl') returned null").toBe("ok");
      const png = decodificarPng(new Uint8Array(await page.screenshot({ type: "png" })));
      // The background is black: a WebGL that doesn't paint would look black, not red.
      expect(leerPixel(png, 100, 100)).toEqual([255, 0, 0]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
