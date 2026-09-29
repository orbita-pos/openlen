// EL EDITOR NO BORRA EL CÓDIGO DEL MODELO — con los scripts REALES del taller en
// Chromium y el motor REAL del servidor.
//
// Hasta el 2026-09-29 cada retoque mandaba el elemento entero leído de la
// pantalla, y el servidor, que tiene que sanear lo que llega del navegador, se
// llevaba por el camino el `onclick` que el modelo había escrito, sus iframes y
// el `<script>` de dentro. Cambiarle el texto a un botón lo dejaba mudo; el
// fondo de una sección, todos los de dentro. Por eso el prompt de Len le
// prohibía los `onclick`: un defecto NUESTRO resuelto con una regla para el
// modelo (memoria `openlen-se-adapta-a-len`).
//
// Ahora el taller hace lo que el `Edit` de Claude Code: nombra lo que cambia
// —el texto de antes y el de después, unos atributos— y todo lo demás sale del
// documento guardado. Aquí se hacen los gestos de verdad y lo que sale por
// `openlen:edit` se aplica con el motor, como en el servidor.
import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import { injectElementInspect } from "./use-element-inspect";
import { injectInlineEdit } from "./use-inline-edit";
import { leerEdicion } from "./leer-edicion";
import { aplicarEdiciones, type Edicion } from "@/lib/page-engine/aplicar-ediciones";

const SECCION =
  '<section id="tienda" style="padding:48px"><h2>Tienda</h2>' +
  '<p>Envío <strong>gratis</strong> desde $500</p>' +
  '<button id="agregar" onclick="agregar(1)">Agregar</button>' +
  '<iframe src="https://open.spotify.com/embed/track/x" width="300" height="80"></iframe>' +
  "<script>window.agregar = function (n) { window.__agregados = (window.__agregados || 0) + n; };</script>" +
  "</section>";

const DOC =
  "<!doctype html><html><head><title>t</title></head><body>" +
  "<main>" +
  SECCION +
  "</main>" +
  "</body></html>";

let server: Server | null = null;
afterAll(() => server?.close());

async function abrir() {
  const conEditor = injectElementInspect(injectInlineEdit(DOC));
  server = createServer((_q, r) => {
    r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    r.end(conEditor);
  });
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  const dir = server!.address();
  if (dir === null || typeof dir === "string") throw new Error("sin puerto");
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });
  await page.evaluate(`(() => {
    window.__ediciones = [];
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'openlen:edit') window.__ediciones.push(e.data);
    });
    document.body.setAttribute('data-openlen-edit-mode', '');
  })()`);
  return { browser, page };
}

/** Lo que el taller mandó, pasado por su frontera y aplicado como el servidor. */
async function guardado(page: import("puppeteer").Page) {
  const crudas = (await page.evaluate("window.__ediciones")) as unknown[];
  const leidas = crudas.map(leerEdicion);
  expect(leidas.every((e) => e !== null), "una edición no pasó la frontera").toBe(true);
  const r = aplicarEdiciones(DOC, leidas as Edicion[]);
  expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
  return { ops: (leidas as Edicion[]).map((e) => e.op), html: r.ok ? r.html : "" };
}

/** Escribe en el texto de un elemento como lo hace el usuario: clic, teclear, Enter. */
async function escribir(page: import("puppeteer").Page, selector: string, texto: string) {
  const caja = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + 4, y: r.top + r.height / 2 };
  });
  await page.mouse.click(caja.x, caja.y);
  await page.waitForSelector("[data-openlen-edit-overlay]");
  await page.evaluate((t) => {
    const o = document.querySelector("[data-openlen-edit-overlay]")!;
    o.textContent = t;
  }, texto);
  await page.keyboard.press("Enter");
  // `postMessage` se entrega en otra vuelta del bucle de eventos.
  await new Promise((r) => setTimeout(r, 300));
}

describe("el código del modelo sobrevive a la mano del usuario", () => {
  it("cambiar el texto de un botón: viaja el texto, y el onclick sigue", async () => {
    const { browser, page } = await abrir();
    try {
      await escribir(page, "#agregar", "Añadir al carrito");
      const g = await guardado(page);
      expect(g.ops).toEqual(["texto"]);
      expect(g.html).toContain('<button id="agregar" onclick="agregar(1)">Añadir al carrito</button>');
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 60_000);

  it("un trozo de un párrafo con marcas: sólo ese nodo", async () => {
    const { browser, page } = await abrir();
    try {
      // Clic sobre el primer trozo («Envío »), no sobre el <strong>.
      await escribir(page, "#tienda p", "Entrega ");
      const g = await guardado(page);
      expect(g.ops).toEqual(["texto"]);
      expect(g.html).toContain("<p>Entrega <strong>gratis</strong> desde $500</p>");
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 60_000);

  it("el fondo de la sección: viaja su style, y el onclick, el iframe y el script de dentro siguen", async () => {
    const { browser, page } = await abrir();
    try {
      await page.evaluate(`window.postMessage({ type: 'openlen:apply-prop', scope: 'style-bg', path: 'main:nth-of-type(1) > section:nth-of-type(1)', kind: 'color', value: '#111111' }, '*')`);
      await new Promise((r) => setTimeout(r, 300));
      const g = await guardado(page);
      expect(g.ops.every((o) => o === "atributos")).toBe(true);
      expect(g.html).toContain("background-color: rgb(17, 17, 17)");
      expect(g.html).toContain('onclick="agregar(1)"');
      expect(g.html).toContain('<iframe src="https://open.spotify.com/embed/track/x"');
      expect(g.html).toContain("window.agregar = function");
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 60_000);

  it("imagen junto al texto: se GUARDA (antes se rechazaba) y lo de dentro sale guardado", async () => {
    const { browser, page } = await abrir();
    try {
      await page.evaluate(`window.postMessage({ type: 'openlen:apply-prop', scope: 'split', path: 'main:nth-of-type(1) > section:nth-of-type(1)', side: 'right', url: 'https://images.openlen.com/x.webp', alt: 'foto' }, '*')`);
      await new Promise((r) => setTimeout(r, 300));
      const g = await guardado(page);
      expect(g.ops).toEqual(["cabeza", "replace"]);
      expect(g.html).toContain("data-ol-split-style");
      expect(g.html).toMatch(/<section id="tienda" style="padding:48px" class="ol-split"><div><h2>Tienda<\/h2>/);
      expect(g.html).toContain('<button id="agregar" onclick="agregar(1)">Agregar</button>');
      expect(g.html).toContain('<iframe src="https://open.spotify.com/embed/track/x"');
      expect(g.html).toContain('<div class="ol-split-media"><img src="https://images.openlen.com/x.webp"');
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 60_000);

  it("convertir el botón en enlace: se GUARDA sobre el <button> guardado, con su texto", async () => {
    const { browser, page } = await abrir();
    try {
      await page.evaluate(`window.postMessage({ type: 'openlen:apply-prop', scope: 'linkify-button', path: 'main:nth-of-type(1) > section:nth-of-type(1) > button:nth-of-type(1)', href: 'https://wa.me/5233' }, '*')`);
      await new Promise((r) => setTimeout(r, 300));
      const g = await guardado(page);
      expect(g.ops).toEqual(["replace"]);
      expect(g.html).toMatch(/<a id="agregar"[^>]*href="https:\/\/wa\.me\/5233"[^>]*>Agregar<\/a>/);
      expect(g.html).not.toContain("<button");
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 60_000);
});
