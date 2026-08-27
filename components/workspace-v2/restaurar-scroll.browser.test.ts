// EL SCROLL SE DEVUELVE CUANDO LA PÁGINA YA MIDE LO QUE VA A MEDIR.
//
// Jesús, 2026-08-26: «no agarra toda la página, el navbar se esconde; me pasa
// cuando le doy al contacto y se va hacia abajo, pero recargo la página y ya
// agarra la página completa».
//
// El lienzo corre en origen opaco, así que el iframe le manda su scroll al
// padre y el padre se lo devuelve al recargar el documento (entrar en modo
// edición obliga a recargar). Ese aviso sale en `DOMContentLoaded` — correcto
// para el modo, y demasiado pronto para el scroll: las imágenes todavía no han
// cargado, el documento MIDE MENOS de lo que va a medir, y `scrollTo` se
// recorta contra esa altura provisional.
//
// ⚠️ LA PRIMERA VERSIÓN DE ESTA PRUEBA NO PROBABA NADA. Le daba a la imagen un
// `height` en CSS, así que el documento ya era alto en `DOMContentLoaded` y el
// fallo no podía ocurrir: pasaba en verde con el arreglo Y SIN ÉL. Lo que la
// hace real es que la altura la traiga la IMAGEN (un SVG con sus dimensiones
// dentro), que es como se comporta una galería de verdad.
import { describe, expect, it, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { injectInlineEdit } from "./use-inline-edit";

const ALTO_IMAGEN = 3000;
const ALTO_HEADER = 80;
const ALTO_FOOTER = 600;
const VENTANA = 800;
const Y_PEDIDO = 2500;

/** La altura vive DENTRO del recurso, no en la hoja de estilos: hasta que
 *  llega, la caja de la imagen es de cero. */
const SVG_ALTO = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="${ALTO_IMAGEN}"><rect width="10" height="${ALTO_IMAGEN}" fill="#888"/></svg>`;

const DOC = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0}
  /* display:block quita el hueco de la linea base: 4px que no vienen a
     cuento. NO se le pone altura: la altura tiene que llegar CON la
     imagen, o la trampa no existe. */
  img{display:block}
  header{height:${ALTO_HEADER}px;background:#111;color:#fff}
  footer{height:${ALTO_FOOTER}px;background:#333}
</style></head><body>
  <header id="navbar">Aguja Negra</header>
  <img src="/lenta.svg" alt="">
  <footer id="contacto">Contacto</footer>
</body></html>`;

let server: Server | null = null;

afterAll(() => {
  server?.close();
});

describe("devolver el scroll tras recargar el documento", () => {
  it("aterriza en el punto pedido aunque la imagen llegue tarde", async () => {
    // El servidor retiene la imagen medio segundo. Durante ese rato el
    // documento mide 680px en una ventana de 800: NO SE PUEDE hacer scroll.
    server = createServer((req, res) => {
      if ((req.url ?? "").startsWith("/lenta.svg")) {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "image/svg+xml" });
          res.end(SVG_ALTO);
        }, 500);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(injectInlineEdit(DOC));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const dir = server!.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");
    const url = `http://127.0.0.1:${dir.port}/`;

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: VENTANA });

      // `domcontentloaded`, no `load`: es EXACTAMENTE el instante en el que el
      // padre manda el scroll de vuelta, con la imagen todavía en el aire.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });

      // Se comprueba que la trampa está armada: si en este instante la página
      // ya fuera alta, la prueba no estaría midiendo el fallo.
      // Lo que importa no es la altura en píxeles sino que NO SE PUEDA hacer
      // scroll: con el documento más corto que la ventana, `scrollHeight` ya
      // viene recortado a la ventana y `scrollTo(0, 2500)` no puede ir a
      // ninguna parte. Ésa es la trampa que el fallo necesita.
      const scrollPosible = (await page.evaluate(
        "document.documentElement.scrollHeight - window.innerHeight",
      )) as number;
      expect(
        scrollPosible,
        "la imagen ya había llegado — esta prueba no reproduce el fallo",
      ).toBe(0);

      await page.evaluate(
        `window.postMessage({ type: 'openlen:restore-scroll', y: ${Y_PEDIDO} }, '*')`,
      );

      // Y ahora se deja cargar del todo, que es lo que pasa en el taller.
      await new Promise((r) => setTimeout(r, 1500));

      const altoDespues = (await page.evaluate("document.documentElement.scrollHeight")) as number;
      expect(altoDespues).toBe(ALTO_HEADER + ALTO_IMAGEN + ALTO_FOOTER);

      const y = (await page.evaluate("window.scrollY")) as number;
      expect(
        Math.round(y),
        "el scroll se devolvió antes de que la página midiera lo que mide",
      ).toBe(Y_PEDIDO);

      // Y el navbar queda ENTERO fuera de pantalla, no cortado por haber
      // aterrizado en un punto arbitrario — que es lo que se veía.
      const navbarTop = (await page.evaluate(
        "document.getElementById('navbar').getBoundingClientRect().top",
      )) as number;
      expect(Math.round(navbarTop)).toBe(-Y_PEDIDO);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
