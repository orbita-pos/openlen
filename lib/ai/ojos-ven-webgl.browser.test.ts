// @vitest-environment node
//
// LOS OJOS DE LEN VEN WEBGL: three.js, un mapa 3D, un juego. Con el Chromium de
// `lanzarChromium` —el de `view_page`, `use_page` y `npm test`— y mirando lo que
// mira Len, la CAPTURA, no sólo si el contexto existe.
//
// MEDIDO el 2026-10-13 en la caja de producción (Chrome 148, sin GPU): con
// `--disable-gpu` a secas `getContext("webgl")` y `"webgl2"` devolvían null, y
// una escena de three.js se veía negra. Con `--enable-unsafe-swiftshader`
// WebGL corre por software (ANGLE sobre SwiftShader) y el pixel sale rojo.
import { describe, expect, it } from "vitest";
import { lanzarChromium } from "./visual-quality-renderer";
import { decodificarPng, leerPixel } from "./png-crudo";

const PAGINA = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="200" height="200" style="display:block"></canvas>
<script>
  const gl = document.getElementById("c").getContext("webgl");
  window.__gl = gl ? "ok" : "null";
  function pinta() { gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(pinta); }
  if (gl) pinta();
</script></body></html>`;

describe("los ojos de Len", () => {
  it("🔴 ven una escena WebGL en la captura", async () => {
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 200, height: 200 });
      await page.setContent(PAGINA, { waitUntil: "load" });
      await new Promise((r) => setTimeout(r, 300));
      expect(await page.evaluate("window.__gl"), "getContext('webgl') devolvió null").toBe("ok");
      const png = decodificarPng(new Uint8Array(await page.screenshot({ type: "png" })));
      // El fondo es negro: un WebGL que no pinta se vería negro, no rojo.
      expect(leerPixel(png, 100, 100)).toEqual([255, 0, 0]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
