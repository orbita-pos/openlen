// EL LIENZO DICE «ESTOY VIVO» ANTES QUE LA APP.
//
// El plazo del lienzo remoto (`PLAZO_LISTO_MS`, 8 s) existe para cazar un host
// que no sirvió nuestro documento —un 404, un documento caducado—: esa página
// no trae los guiones del editor y su aviso no llega nunca. El aviso era
// `openlen:iframe-ready`, que sale en DOMContentLoaded… y DOMContentLoaded
// ESPERA a los `<script type="module">`. En una app eso es esperar a que el
// servidor empaquete la app (2–4 s medidos, más en cola) y a que se descargue y
// se ejecute: un host vivo con un paquete lento se tomaba por un host muerto,
// el lienzo caía a local y se quedaba ahí. Jesús, 10/10: «The app can't run
// here: the real canvas isn't responding».
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";

import { injectInlineEdit } from "./use-inline-edit";
import { injectPageLinks } from "./use-page-links";
import { SANDBOX_REMOTO } from "./sandbox-del-lienzo";

const MODULO_TARDA_MS = 3_000;

// El cascarón de una app con los guiones del editor, como lo sube el taller.
const CASCARON = injectPageLinks(
  injectInlineEdit(
    '<!doctype html><html><head><title>app</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  ),
);

describe("el lienzo remoto de una app, con un paquete que tarda", () => {
  it("avisa de que está vivo en cuanto llega el documento, sin esperar al módulo de la app", async () => {
    const srv = createServer((req, res) => {
      if (req.url === "/src/main.jsx") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
          res.end("document.getElementById('root').textContent = 'app';");
        }, MODULO_TARDA_MS);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        req.url === "/lienzo"
          ? CASCARON
          : "<!doctype html><html><body><script>window.__avisos = [];" +
              "window.addEventListener('message', function (e) { if (e.data && e.data.type) window.__avisos.push({ tipo: e.data.type, ms: performance.now() }); });</script>" +
              `<iframe src="/lienzo" sandbox="${SANDBOX_REMOTO}"></iframe></body></html>`,
      );
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const dir = srv.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForFunction("window.__avisos.some(function (a) { return a.tipo === 'openlen:iframe-ready'; })", { timeout: 20_000 });
      const avisos = (await page.evaluate("window.__avisos")) as Array<{ tipo: string; ms: number }>;
      const vivo = avisos.find((a) => a.tipo === "openlen:lienzo-vivo");
      const listo = avisos.find((a) => a.tipo === "openlen:iframe-ready")!;

      // BRAZO DE CONTROL: el módulo lento de verdad retrasa DOMContentLoaded.
      // Sin esto, que «vivo» llegue pronto no diría nada.
      expect(listo.ms, "iframe-ready no esperó al módulo: la prueba no mide nada").toBeGreaterThan(MODULO_TARDA_MS);

      expect(vivo, "el lienzo no avisó de que está vivo").toBeDefined();
      expect(vivo!.ms, "«vivo» esperó al paquete de la app").toBeLessThan(MODULO_TARDA_MS / 2);
    } finally {
      await browser.close();
      srv.close();
    }
  }, 60_000);
});
