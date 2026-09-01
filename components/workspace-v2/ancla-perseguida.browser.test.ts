// UN ANCLA SE PERSIGUE HASTA QUE LLEGA, NO SE DISPARA UNA VEZ.
//
// Jesús, 2026-09-01: «se pierde cuando le doy a un button que desplaza hacia
// abajo, se pierde abajo y la altura se rompe». Un enlace `#trabajos` del tipo
// «Ver trabajos».
//
// 🔴 EL FALLO NO ES DE MOMENTO, ES DE FORMA. `scrollIntoView` es una orden de
// UN SOLO DISPARO contra la maqueta de ese instante. Medido con Chromium sobre
// una reproducción mínima el 2026-09-01:
//
//   1. load, imagen aún en el aire   altoDoc= 800  maxScroll=   0  top#trabajos= 445
//   2. tras pulsar «Ver trabajos»    altoDoc= 800  maxScroll=   0  top#trabajos= 445
//   3. la imagen crece el documento  altoDoc=1925  maxScroll=1125  top#trabajos=1725
//
// En el paso 2 `maxScroll` es CERO: no hay a dónde desplazarse, así que la
// orden no se desplaza mal — se pierde entera, en silencio. Después el
// documento crece y el destino queda 1725px más abajo.
//
// Por eso mover el instante nunca cerró el fallo (`fb659450` lo movió de
// `DOMContentLoaded` a `load`): NO EXISTE un «ya terminó de medir» que
// perseguir. Después de `load` el documento sigue creciendo por cuatro relojes
// distintos — imágenes perezosas, fuentes que se intercambian, Tailwind por CDN
// compilando en runtime, y el JavaScript del modelo.
//
// LA TRAMPA DE ESTA PRUEBA es la misma que la de `restaurar-scroll.browser`, y
// por el mismo motivo: la altura tiene que llegar CON la imagen (un SVG con sus
// dimensiones dentro), nunca por CSS. Con `height` en la hoja el documento ya
// sería alto al pulsar y la prueba pasaría en verde CON el arreglo y SIN él.
import { describe, expect, it, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { injectPageLinks } from "./use-page-links";
import { injectInlineEdit } from "./use-inline-edit";

const ALTO_IMAGEN = 3000;
const VENTANA = 800;

const SVG_ALTO = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="${ALTO_IMAGEN}"><rect width="10" height="${ALTO_IMAGEN}" fill="#888"/></svg>`;

const DOC = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:system-ui}
  img{display:block}
  section{padding:24px}
  #trabajos{background:#e8ded0}
</style></head><body>
  <section id="hero"><h1>Estudio</h1><a href="#trabajos" id="ver">Ver trabajos</a></section>
  <section><img src="/lenta.svg" alt=""></section>
  <section id="trabajos"><h2>Trabajos</h2><p>última sección</p></section>
</body></html>`;

let server: Server | null = null;
afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

describe("el ancla del lienzo", () => {
  it("deja el destino arriba AUNQUE el documento crezca después de pulsar", async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/lenta.svg")) {
        // Llega TARDE, como una foto de verdad o una imagen perezosa.
        setTimeout(() => {
          res.writeHead(200, { "content-type": "image/svg+xml" });
          res.end(SVG_ALTO);
        }, 500);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(injectPageLinks(DOC));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const dir = server!.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: VENTANA });
      // `domcontentloaded`: el instante en el que el usuario ya ve la página y
      // puede pulsar, con la imagen todavía en el aire.
      await page.goto(`http://127.0.0.1:${dir.port}/`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      // LA TRAMPA, ARMADA: si aquí ya se pudiera hacer scroll, esta prueba no
      // estaría midiendo el fallo.
      const scrollPosible = (await page.evaluate(
        "document.documentElement.scrollHeight - window.innerHeight",
      )) as number;
      expect(
        scrollPosible,
        "la imagen ya había llegado — esta prueba no reproduce el fallo",
      ).toBe(0);

      await page.click("#ver");

      // Se deja que la imagen llegue y el documento crezca, que es lo que pasa
      // en el taller mientras el usuario mira.
      await new Promise((r) => setTimeout(r, 1800));

      const alto = (await page.evaluate("document.documentElement.scrollHeight")) as number;
      expect(alto, "la imagen no llegó a crecer el documento").toBeGreaterThan(VENTANA);

      const top = (await page.evaluate(
        "Math.round(document.getElementById('trabajos').getBoundingClientRect().top)",
      )) as number;

      // ⚠️ LO QUE SE EXIGE ES QUE ESTÉ A LA VISTA, no que esté a 0.
      //
      // La primera versión de esta prueba pedía `top ≈ 0` y era IMPOSIBLE de
      // cumplir: `#trabajos` es la última sección y mide menos que la ventana,
      // así que ponerla arriba del todo exigiría desplazarse más allá del final
      // del documento. El navegador recorta en `maxScroll` y ahí se queda —
      // correctamente. Medido: el perseguidor llega a `scrollY = maxScroll` y
      // el destino queda a 685px, que es lo mejor que se puede hacer.
      //
      // La diferencia que SÍ importa, y que esta prueba mide: sin perseguir, el
      // destino acaba a 3203px — fuera de la ventana, invisible. Con perseguir,
      // dentro. Ésa es la experiencia del usuario, y no un número redondo.
      expect(
        top,
        "el ancla se disparó una vez contra un documento provisional y el destino quedó fuera de la ventana",
      ).toBeGreaterThanOrEqual(0);
      expect(top, "el destino quedó fuera de la ventana").toBeLessThan(VENTANA);

      // Y se llegó tan lejos como el documento permite: si el destino no puede
      // subir del todo, al menos el scroll está en su tope.
      const y = (await page.evaluate("Math.round(window.scrollY)")) as number;
      const max = (await page.evaluate(
        "document.documentElement.scrollHeight - window.innerHeight",
      )) as number;
      expect(y, "quedó scroll sin usar con el destino aún abajo").toBe(max);
    } finally {
      await browser.close();
    }
  }, 40_000);

  // 🔴 «QUE SEA UN BUTTON O UN A, TODO DEBE DE FUNCIONAR» — Jesús, 2026-09-01.
  //
  // Y tenía razón: la primera versión del arreglo interceptaba el CLIC de un
  // `<a>`, así que un `<button>` cuyo desplazamiento lo hace el JavaScript del
  // MODELO seguía roto igual. Eso era arreglar un camino, no el problema.
  //
  // Lo que esta prueba sujeta es la decisión de envolver la PRIMITIVA: dentro
  // del lienzo, cualquiera que llame a `scrollIntoView` recibe la versión que
  // se mantiene — sin saberlo, y sin tener que acordarse. Aquí NO hay
  // interceptor de enlaces: sólo el runtime del editor y el script del modelo.
  it("un <button> con JavaScript del MODELO funciona igual que un <a>", async () => {
    const DOC_BOTON = DOC.replace(
      '<a href="#trabajos" id="ver">Ver trabajos</a>',
      '<button id="ver">Ver trabajos</button>' +
        "<script>document.getElementById('ver').addEventListener('click',function(){" +
        "document.getElementById('trabajos').scrollIntoView();});<\/script>",
    );
    const srv = createServer((req, res) => {
      if (req.url?.startsWith("/lenta.svg")) {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "image/svg+xml" });
          res.end(SVG_ALTO);
        }, 500);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(injectInlineEdit(DOC_BOTON));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const d = srv.address();
    if (d === null || typeof d === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: VENTANA });
      await page.goto(`http://127.0.0.1:${d.port}/`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      expect(
        await page.evaluate("document.documentElement.scrollHeight - window.innerHeight"),
        "la imagen ya había llegado — esta prueba no reproduce el fallo",
      ).toBe(0);

      await page.click("#ver");
      await new Promise((r) => setTimeout(r, 1800));

      const top = (await page.evaluate(
        "Math.round(document.getElementById('trabajos').getBoundingClientRect().top)",
      )) as number;
      expect(top, "el <button> del modelo se quedó sin perseguir").toBeGreaterThanOrEqual(0);
      expect(top, "el destino quedó fuera de la ventana").toBeLessThan(VENTANA);
    } finally {
      await browser.close();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 40_000);
});
