// @vitest-environment node
//
// CAMBIAR LA FOTO NO PUEDE MOVER EL MARCO.
//
// Jesús, 19/09/2026, con una captura: puso una foto en la tarjeta de un viaje y
// debajo quedó una banda del azul del hueco. Medido: el hueco era 4:3 y la foto
// nueva 16:9, así que encogía 57 px y el fondo del hueco asomaba.
//
// La causa era una asimetría en `performSwap` (use-image-replace.ts): cuando el
// hueco era un <div> o un <svg>, al convertirlo en <img> se le añadía
// `object-cover`; cuando YA era un <img>, sólo se le cambiaba el `src`. Con el
// preflight de Tailwind (`img { height: auto }`) eso basta para que una foto de
// otra proporción encoja. Antes cuadraba de casualidad: la foto vieja tenía
// justo la proporción del hueco.
//
// La regla que se aplica ahora es la de un editor visual: EL MARCO ES DE LA
// PÁGINA Y LOS PÍXELES SON DE LA FOTO. Se mide el hueco antes del cambio y sólo
// se restaura si el reemplazo rompió algo que ya cuadraba — y el recorte lo
// decide la página si ya lo había declarado.
//
// CUBRE  la geometría en Chromium (la banda, en píxeles) Y que el arreglo
//        SOBREVIVE al guardado: las ediciones reales se aplican con
//        `aplicarEdiciones`, que es lo que acaba en la base.
// NO CUBRE  si la foto elegida queda bien encuadrada — eso es gusto, no medida.
//
// BRAZO DE CONTROL: tres contra-casos que NO deben tocarse (c1 una foto que
// fluye, c2 un logo con `object-contain`, c3 una foto que nunca llenó su
// hueco). Sin ellos la prueba pasaría igual con un arreglo que le mete
// `object-cover` a todo, que es justo lo que no queremos: re-decidir por encima
// del modelo.
import { describe, expect, it, afterAll } from "vitest";
import { createServer, type Server } from "node:http";

import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { aplicarEdiciones } from "@/lib/page-engine/aplicar-ediciones";

/** Un SVG como data-URL: da tamaño intrínseco sin salir a la red. */
function foto(w: number, h: number, color: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    w +
    '" height="' +
    h +
    '"><rect width="' +
    w +
    '" height="' +
    h +
    '" fill="' +
    color +
    '"/></svg>';
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const VIEJA = foto(1200, 900, "#d8cbb8"); // 4:3 — la que cuadraba con el hueco
const NUEVA = foto(1600, 900, "#c9a227"); // 16:9 — la que el usuario pone

// Las reglas del preflight de Tailwind v3 de las que depende el fallo, escritas
// a mano: la prueba no sale a la red a por el CDN. `aspect-[4/3]` y `w-full` van
// igual como CSS plano porque aquí no corre el JIT de Tailwind.
const CSS =
  "img { display: block; max-width: 100%; height: auto; }" +
  ".marco { width: 303px; aspect-ratio: 4 / 3; background: #2b7fff; overflow: hidden; }" +
  ".llena { width: 100%; }" +
  ".llena-bien { width: 100%; height: 100%; object-fit: cover; }" +
  ".por-css img { width: 100%; }" +
  ".logo { width: 100%; height: 100%; object-fit: contain; }" +
  ".mitad { width: 50%; }" +
  ".fluye { width: 303px; padding: 16px; }";

function tarjeta(caso: string, clase: string): string {
  return (
    '<div class="marco" id="' +
    caso +
    '"><img src="' +
    VIEJA +
    '" alt="" data-caso="' +
    caso +
    '" class="' +
    clase +
    '"></div>'
  );
}

const DOC =
  "<!doctype html><html><head><title>t</title><style>" +
  CSS +
  "</style></head><body data-openlen-edit-mode>" +
  tarjeta("v1", "llena") +
  tarjeta("v2", "llena-bien") +
  '<div class="marco por-css" id="v3"><img src="' +
  VIEJA +
  '" alt="" data-caso="v3"></div>' +
  '<div class="fluye" id="c1"><img src="' +
  VIEJA +
  '" alt="" data-caso="c1" class="llena"></div>' +
  tarjeta("c2", "logo") +
  tarjeta("c3", "mitad") +
  "</body></html>";

const CASOS = ["v1", "v2", "v3", "c1", "c2", "c3"] as const;
const CON_EDITOR = injectImageReplace(DOC);

type Medida = {
  id: string;
  hueco: number;
  foto: number;
  fit: string;
  style: string;
};

let server: Server | null = null;
afterAll(() => server?.close());

/** La etiqueta <img> de un caso, tal y como quedó en el documento guardado. */
function etiqueta(html: string, caso: string): string {
  const m = html.match(new RegExp('<img[^>]*data-caso="' + caso + '"[^>]*>'));
  return m ? m[0] : "";
}

describe("cambiar la foto no mueve el marco", () => {
  it("rellena el hueco que ya llenaba, y no toca lo demás", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(CON_EDITOR);
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
      await page.setViewport({ width: 1400, height: 900 });
      await page.goto(`http://127.0.0.1:${dir.port}/`, {
        waitUntil: "load",
        timeout: 20_000,
      });

      // El buzón donde caen las ediciones que el inyector manda al padre.
      await page.evaluate(`(() => {
        window.__ediciones = [];
        window.addEventListener('message', function (e) {
          if (e.data && e.data.type === 'openlen:edit') window.__ediciones.push(e.data);
        });
      })()`);

      const banda = () =>
        page.evaluate(`(() => {
          return ['v1','v2','v3','c1','c2','c3'].map(function (id) {
            var img = document.querySelector('[data-caso="' + id + '"]');
            var marco = img.parentElement;
            var cs = getComputedStyle(marco);
            var alto = marco.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
            return {
              id: id,
              hueco: Math.round(alto),
              foto: Math.round(img.getBoundingClientRect().height),
              fit: getComputedStyle(img).objectFit,
              style: img.getAttribute('style') || ''
            };
          });
        })()`) as Promise<Medida[]>;

      const antes = await banda();
      // Punto de partida: ninguna tarjeta enseña banda salvo la que nunca llenó
      // su hueco (c3), que es su estado normal.
      for (const a of antes) {
        if (a.id === "c3") continue;
        expect(a.hueco - a.foto, `${a.id} parte con banda`).toBeLessThanOrEqual(1);
      }

      // El reemplazo REAL: clic en la foto → el inyector manda la ruta al
      // padre → el padre devuelve la foto elegida, igual que hace el modal.
      for (const caso of CASOS) {
        const ruta = (await page.evaluate(`(async () => {
          var img = document.querySelector('[data-caso="${caso}"]');
          var got = new Promise(function (res) {
            var h = function (e) {
              if (e.data && e.data.type === 'openlen:asset-clicked') {
                window.removeEventListener('message', h);
                res(e.data.path);
              }
            };
            window.addEventListener('message', h);
            setTimeout(function () { res(null); }, 1000);
          });
          img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return got;
        })()`)) as string | null;
        expect(ruta, `no se abrió el reemplazo para ${caso}`).toBeTruthy();
        await page.evaluate(
          `window.postMessage({ type: 'openlen:swap-asset', kind: 'image', path: ${JSON.stringify(
            ruta,
          )}, payload: { url: ${JSON.stringify(NUEVA)}, alt: 'x' } }, '*')`,
        );
      }
      await new Promise((r) => setTimeout(r, 700));
      const despues = await banda();
      const por = (id: string) => despues.find((d) => d.id === id)!;

      // 🔴 Lo que se rompía: el hueco de altura fija queda lleno.
      expect(por("v1").hueco - por("v1").foto, "v1 sigue con banda").toBeLessThanOrEqual(1);
      expect(por("v3").hueco - por("v3").foto, "v3 sigue con banda").toBeLessThanOrEqual(1);
      // Y la que ya estaba bien escrita sigue igual, sin que le añadamos nada.
      expect(por("v2").hueco - por("v2").foto).toBeLessThanOrEqual(1);
      expect(por("v2").style, "v2 no necesitaba arreglo").toBe("");

      // BRAZO DE CONTROL — lo que NO se toca.
      // c1: el alto lo marcaba la foto, así que la página debe seguir fluyendo.
      expect(por("c1").style, "c1 no debe llevar estilo nuestro").toBe("");
      expect(por("c1").hueco - por("c1").foto).toBeLessThanOrEqual(1);
      // c2: la página ya declaró `contain` — un logo no se recorta.
      expect(por("c2").fit, "c2 perdió su object-contain").toBe("contain");
      // c3: nunca llenó su hueco; su tamaño no es asunto del marco.
      expect(por("c3").style, "c3 no debe llevar estilo nuestro").toBe("");

      // Y AHORA LO QUE DE VERDAD SE GUARDA: las ediciones que salieron por
      // `openlen:edit`, aplicadas al documento con el motor real.
      const ediciones = (await page.evaluate("window.__ediciones")) as Array<{
        path: string;
        tag: string;
        hijos: string[];
        html: string;
      }>;
      expect(ediciones.length, "el inyector no mandó ninguna edición").toBeGreaterThan(0);
      const r = aplicarEdiciones(
        DOC,
        ediciones.map((e) => ({
          op: "replace" as const,
          path: e.path,
          tag: e.tag,
          hijos: e.hijos,
          html: e.html,
        })),
      );
      expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
      if (!r.ok) return;
      expect(etiqueta(r.html, "v1"), "v1 no guardó el encaje").toContain("object-fit: cover");
      expect(etiqueta(r.html, "v3"), "v3 no guardó el encaje").toContain("object-fit: cover");
      expect(etiqueta(r.html, "c1"), "c1 se guardó con estilo nuestro").not.toContain("style=");
      expect(etiqueta(r.html, "c3"), "c3 se guardó con estilo nuestro").not.toContain("style=");
      // Y la foto NUEVA está en las seis, que es lo que el usuario pidió. Sin
      // esto los tres contra-casos pasarían en verde sin haberse reemplazado
      // nada: «no lleva estilo nuestro» es trivial si el clic no hizo nada.
      for (const caso of CASOS) {
        expect(etiqueta(r.html, caso), `${caso} no recibió la foto nueva`).toContain(NUEVA);
      }
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 120_000);

  // 🔴 EL CASO REAL DE JESUS, leido de su pagina en produccion el 2026-09-20.
  // El hueco no era un <img>: era un <div> con degradado y un <svg> encima con
  // position:absolute;inset:0. Al convertir el <svg> en <img> se copiaba el
  // `class` y NO el `style`, asi que la foto caia al flujo con h-auto dentro de
  // un marco aspect-ratio:4/3 y dejaba 57 px del degradado asomando. La rama
  // del icono, en ese mismo `performSwap`, si copiaba el estilo.
  it("un <svg> que llena su hueco por estilo en linea se sustituye sin banda", async () => {
    const TARJETA =
      "<!doctype html><html><head><title>t</title><style>" +
      "img, svg { display:block; max-width:100%; height:auto; }" +
      ".tarjeta { width:303px; background:#fff; overflow:hidden; }" +
      "</style></head><body data-openlen-edit-mode>" +
      '<article class="tarjeta">' +
      '<div id="hueco" style="aspect-ratio:4/3;background:linear-gradient(150deg,#123a6b,#3f6fa8 60%,#a9c6e4);position:relative">' +
      '<svg viewBox="0 0 400 300" class="max-w-full h-auto" style="position:absolute;inset:0;width:100%;height:100%" aria-hidden="true">' +
      '<rect x="40" y="120" width="46" height="150" fill="rgba(255,255,255,.28)"></rect></svg>' +
      '<span style="position:absolute;top:12px;left:12px">5 noches</span>' +
      "</div><div><h3>Nueva York</h3></div></article></body></html>";

    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(injectImageReplace(TARJETA));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const dir = srv.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 700, height: 600 });
      await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });

      const mide = () =>
        page.evaluate(`(() => {
          var h = document.getElementById('hueco');
          var m = h.getBoundingClientRect();
          var el = h.querySelector('img') || h.querySelector('svg');
          var r = el.getBoundingClientRect();
          return { etiqueta: el.tagName.toLowerCase(), desajuste: Math.round(m.bottom - r.bottom) };
        })()`) as Promise<{ etiqueta: string; desajuste: number }>;

      const antes = await mide();
      expect(antes.etiqueta).toBe("svg");
      expect(antes.desajuste, "la tarjeta parte descuadrada").toBeLessThanOrEqual(1);

      // Clic DIRECTO sobre el dibujo: la otra puerta del modal, la que Jesus usa.
      const ruta = (await page.evaluate(`(async () => {
        var svg = document.querySelector('#hueco svg');
        var got = new Promise(function (res) {
          var h = function (e) {
            if (e.data && e.data.type === 'openlen:asset-clicked') {
              window.removeEventListener('message', h);
              res(e.data.path);
            }
          };
          window.addEventListener('message', h);
          setTimeout(function () { res(null); }, 1000);
        });
        svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return got;
      })()`)) as string | null;
      expect(ruta, "el clic sobre el dibujo no abrio el reemplazo").toBeTruthy();
      await page.evaluate(
        `window.postMessage({ type: 'openlen:swap-asset', kind: 'image', path: ${JSON.stringify(
          ruta,
        )}, payload: { url: ${JSON.stringify(NUEVA)}, alt: '' } }, '*')`,
      );
      await new Promise((r) => setTimeout(r, 600));

      const despues = await mide();
      expect(despues.etiqueta, "el dibujo no se convirtio en foto").toBe("img");
      expect(Math.abs(despues.desajuste), "la foto dejo el degradado asomando").toBeLessThanOrEqual(1);
    } finally {
      await browser.close();
      srv.close();
    }
  }, 120_000);

  // El mismo marco, otro gesto: arrastrar una foto encima de otra las
  // intercambia (use-drop-place -> applySwapImages). Antes del 19/09 esto
  // sacaba a LAS DOS de su hueco y en direcciones opuestas.
  it("intercambiar dos fotos deja a las dos en su marco", async () => {
    const DOS =
      "<!doctype html><html><head><title>t</title><style>" +
      "img { display:block; max-width:100%; height:auto; }" +
      ".marco { width:303px; aspect-ratio:4/3; background:#2b7fff; overflow:hidden; }" +
      ".ancho { aspect-ratio:16/9; }" +
      ".llena { width:100%; }" +
      "</style></head>" +
      '<body data-openlen-edit-mode style="display:flex;gap:16px;align-items:flex-start">' +
      '<div class="marco"><img src="' + VIEJA + '" alt="" data-caso="a" class="llena"></div>' +
      '<div class="marco ancho"><img src="' + NUEVA + '" alt="" data-caso="b" class="llena"></div>' +
      "</body></html>";

    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(injectElementInspect(DOS));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const dir = srv.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 900, height: 600 });
      await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });

      const desajuste = () =>
        page.evaluate(`(() => {
          return ['a','b'].map(function (id) {
            var img = document.querySelector('[data-caso="' + id + '"]');
            var m = img.parentElement.getBoundingClientRect();
            var r = img.getBoundingClientRect();
            return { id: id, desajuste: Math.round(m.bottom - r.bottom) };
          });
        })()`) as Promise<Array<{ id: string; desajuste: number }>>;

      // Las dos parten encajadas: cada foto tiene la proporción de su hueco.
      for (const d of await desajuste()) {
        expect(d.desajuste, `${d.id} parte descuadrada`).toBeLessThanOrEqual(1);
      }

      await page.evaluate(`window.postMessage({
        type: 'openlen:apply-prop', scope: 'swap-images',
        fromPath: 'div:nth-of-type(1) > img:nth-of-type(1)',
        toPath: 'div:nth-of-type(2) > img:nth-of-type(1)'
      }, '*')`);
      await new Promise((r) => setTimeout(r, 600));

      // 🔴 Lo que se rompía, y en las dos direcciones: la 4:3 en el hueco 16:9
      // se quedaba corta (banda) y la 16:9 en el hueco 4:3 lo DESBORDABA — con
      // overflow:hidden la recorta por donde caiga, y sin él se come lo de
      // abajo. Por eso se mide el valor absoluto.
      for (const d of await desajuste()) {
        expect(Math.abs(d.desajuste), `${d.id} quedó descuadrada`).toBeLessThanOrEqual(1);
      }
      // Y las fotos se intercambiaron de verdad, que es lo que se pidió.
      const src = (await page.evaluate(`(() => {
        return ['a','b'].map(function (id) {
          return document.querySelector('[data-caso="' + id + '"]').getAttribute('src');
        });
      })()`)) as string[];
      expect(src[0]).toBe(NUEVA);
      expect(src[1]).toBe(VIEJA);
    } finally {
      await browser.close();
      srv.close();
    }
  }, 120_000);

  // Tercer gesto: el asa de la esquina. Pide ANCHURA, y de paso escribía
  // height:auto — que anulaba el alto que la página había declarado.
  it("el asa de tamaño no le quita el alto a una foto que llena su marco", async () => {
    const UNA =
      "<!doctype html><html><head><title>t</title><style>" +
      "img { display:block; max-width:100%; height:auto; }" +
      ".marco { width:303px; aspect-ratio:4/3; background:#2b7fff; overflow:hidden; }" +
      "</style></head>" +
      '<body data-openlen-edit-mode style="padding:24px">' +
      '<div class="marco"><img src="' +
      VIEJA +
      '" alt="" data-caso="u" class="llena-bien" style="width:100%;height:100%;object-fit:cover"></div>' +
      "</body></html>";

    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(injectImageReplace(UNA));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const dir = srv.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 900, height: 600 });
      await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });

      const caja = (await page.evaluate(`(() => {
        var img = document.querySelector('[data-caso="u"]');
        var r = img.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`)) as { x: number; y: number; w: number; h: number };

      // Pasar el ratón por encima es lo que saca el asa.
      await page.mouse.move(caja.x + caja.w / 2, caja.y + caja.h / 2);
      await new Promise((r) => setTimeout(r, 300));
      const asa = (await page.evaluate(`(() => {
        var g = document.querySelector('.openlen-resize-grip');
        if (!g || g.style.display === 'none') return null;
        var r = g.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`)) as { x: number; y: number } | null;
      expect(asa, "el asa no apareció sobre la foto").toBeTruthy();
      if (!asa) return;

      await page.mouse.move(asa.x, asa.y);
      await page.mouse.down();
      await page.mouse.move(asa.x - 40, asa.y, { steps: 6 });
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 400));

      const fin = (await page.evaluate(`(() => {
        var img = document.querySelector('[data-caso="u"]');
        var m = img.parentElement.getBoundingClientRect();
        var r = img.getBoundingClientRect();
        return {
          banda: Math.round(m.bottom - r.bottom),
          ancho: Math.round(r.width),
          style: img.getAttribute('style') || ''
        };
      })()`)) as { banda: number; ancho: number; style: string };

      // 🔴 El alto sigue siendo el del marco: cero banda.
      expect(fin.banda, "el asa sacó la foto de su marco").toBeLessThanOrEqual(1);
      expect(fin.style, "el asa volvió a escribir height:auto").not.toContain("height: auto");
      // CONTRA-PRUEBA: y el arrastre sirvió de algo — la anchura bajó de verdad.
      expect(fin.ancho, "el arrastre no estrechó nada").toBeLessThan(caja.w - 10);
    } finally {
      await browser.close();
      srv.close();
    }
  }, 120_000);
});
