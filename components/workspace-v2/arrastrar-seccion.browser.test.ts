// @vitest-environment node
//
// ARRASTRAR UNA SECCIÓN: LO QUE SE GUARDA ES LO QUE SE VE.
//
// `mover-secciones.browser.test.ts` cubre las FLECHAS de la barra, y construye
// la edición a mano. El arrastre de verdad —puntero sobre el asa, umbral,
// predicción del hueco con los bordes de la sección arrastrada, mutación del
// DOM y `postMovimiento`— no lo cubría nadie, y es el camino donde una
// divergencia sale cara: el usuario ve un orden en el taller y la página
// publicada sale con otro, sin aviso.
//
// La sonda arrastra de verdad (`page.mouse`) y compara DOS cosas que tienen que
// decir lo mismo: el orden que queda en el lienzo y el orden del documento tras
// aplicar la edición con el motor real (`aplicarEdiciones`).
//
// CUBRE  arrastrar con el raton hacia arriba y hacia abajo, con el DEDO
//        (pulsacion larga), mover un BLOQUE dentro de su seccion, y que no se
//        pierda ni se duplique nada.
// NO CUBRE  si la animacion FLIP se ve bien, ni el arrastre en un movil de
//        verdad: lo tactil va con la emulacion de Chromium.
//
// 🔴 OJO al escribir más casos: hay un asa POR SECCIÓN y todas cuelgan del
// <body>. Coger `.openlen-reorder-handle` a secas arrastra SIEMPRE la primera
// sección — la primera versión de esta sonda pasaba en verde sin mover lo que
// creía mover. Hay que nombrarla por `data-handle-idx`.
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";

import { injectSectionReorder } from "./use-section-reorder";
import { aplicarEdiciones } from "@/lib/page-engine/aplicar-ediciones";

const ALTO = 200;
const SEC = (t: string) =>
  `<section style="height:${ALTO}px;background:#eee;margin:0"><h2>${t}</h2></section>`;

const DOC =
  "<!doctype html><html><head><title>t</title>" +
  "<style>body{margin:0}section{box-sizing:border-box}</style></head>" +
  "<body data-openlen-edit-mode>" +
  SEC("Uno") +
  SEC("Dos") +
  SEC("Tres") +
  SEC("Cuatro") +
  "</body></html>";

const CON_EDITOR = injectSectionReorder(DOC);

type Edicion = {
  path: string;
  tag: string;
  hijos: string[];
  destino: string;
  destinoTag: string;
  destinoHijos: string[];
  posicion: "antes" | "despues";
};

function orden(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/gi)].map((m) => m[1]!.trim());
}

/** Arrastra la sección `idx` moviendo el puntero `dy` píxeles. Devuelve el
 *  orden que queda en el lienzo y las ediciones que salieron. */
async function arrastrar(idx: number, dy: number) {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(CON_EDITOR);
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
    await page.setViewport({ width: 900, height: 1000 });
    await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });

    await page.evaluate(`(() => {
      window.__ediciones = [];
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'openlen:edit') window.__ediciones.push(e.data);
      });
    })()`);

    // El asa sólo se coloca cuando el ratón pasa por su sección.
    const centro = (await page.evaluate(`(() => {
      var s = document.querySelectorAll('body > section')[${idx}];
      var r = s.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)) as { x: number; y: number };
    await page.mouse.move(centro.x, centro.y);
    await new Promise((r) => setTimeout(r, 250));

    const asa = (await page.evaluate(`(() => {
      var h = document.querySelector('.openlen-reorder-handle[data-handle-idx="${idx}"]');
      if (!h) return null;
      var r = h.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)) as { x: number; y: number } | null;
    if (!asa) throw new Error("el asa de la sección " + idx + " no apareció");

    await page.mouse.move(asa.x, asa.y);
    await page.mouse.down();
    // El primer movimiento pasa el umbral; el segundo, a pasos, es el arrastre
    // (el motor lee el recorrido, no el salto).
    await page.mouse.move(asa.x, asa.y + Math.sign(dy) * 12, { steps: 3 });
    await page.mouse.move(asa.x, asa.y + dy, { steps: 20 });
    await new Promise((r) => setTimeout(r, 150));
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 700));

    const lienzo = (await page.evaluate(`(() => {
      return [].slice.call(document.querySelectorAll('body > section h2')).map(function (h) {
        return h.textContent.trim();
      });
    })()`)) as string[];
    const ediciones = (await page.evaluate("window.__ediciones")) as Edicion[];
    return { lienzo, ediciones };
  } finally {
    await browser.close();
    srv.close();
  }
}

/** Igual que `arrastrar`, pero con el DEDO: pulsación larga y luego mover. */
async function arrastrarConElDedo(idx: number, dy: number) {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(CON_EDITOR);
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
    // hasTouch enciende la emulación táctil: sin esto los eventos salen con
    // pointerType "mouse" y la pulsación larga no se ejerce.
    await page.setViewport({ width: 900, height: 1000, hasTouch: true, isMobile: false });
    await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });

    await page.evaluate(`(() => {
      window.__ediciones = [];
      window.__ev = [];
      ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend'].forEach(function (t) {
        document.addEventListener(t, function (e) {
          window.__ev.push(t + ':' + (e.pointerId !== undefined ? e.pointerId : '-') + ':' + (e.pointerType || '-'));
        }, true);
      });
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'openlen:edit') window.__ediciones.push(e.data);
      });
    })()`);

    // El asa aparece al pasar por encima; con el dedo no hay «pasar por
    // encima», así que se coloca con un mousemove y se pulsa con el dedo.
    const centro = (await page.evaluate(`(() => {
      var s = document.querySelectorAll('body > section')[${idx}];
      var r = s.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)) as { x: number; y: number };
    await page.mouse.move(centro.x, centro.y);
    await new Promise((r) => setTimeout(r, 250));

    const asa = (await page.evaluate(`(() => {
      var h = document.querySelector('.openlen-reorder-handle[data-handle-idx="${idx}"]');
      if (!h) return null;
      var r = h.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)) as { x: number; y: number } | null;
    if (!asa) throw new Error("el asa de la sección " + idx + " no apareció");

    await page.touchscreen.touchStart(asa.x, asa.y);
    // LA PULSACIÓN LARGA. Antes del temporizador, moverse cancela: eso es
    // scroll, no arrastre. Así que aquí se espera quieto.
    await new Promise((r) => setTimeout(r, 700));
    const armado = (await page.evaluate(`(() => {
      var s = [].slice.call(document.querySelectorAll('body > section'));
      return s.some(function (x) { return x.style.zIndex === '999998'; });
    })()`)) as boolean;

    await page.touchscreen.touchMove(asa.x, asa.y + dy);
    await new Promise((r) => setTimeout(r, 200));
    await page.touchscreen.touchEnd();
    await new Promise((r) => setTimeout(r, 700));

    const lienzo = (await page.evaluate(`(() => {
      return [].slice.call(document.querySelectorAll('body > section h2')).map(function (h) {
        return h.textContent.trim();
      });
    })()`)) as string[];
    const ediciones = (await page.evaluate("window.__ediciones")) as Edicion[];
    const eventos = (await page.evaluate("window.__ev")) as string[];
    return { lienzo, ediciones, armado, eventos };
  } finally {
    await browser.close();
    srv.close();
  }
}

function guardado(ediciones: Edicion[], doc = DOC) {
  return aplicarEdiciones(
    doc,
    ediciones.map((e) => ({
      op: "mover" as const,
      path: e.path,
      tag: e.tag,
      hijos: e.hijos,
      destino: e.destino,
      destinoTag: e.destinoTag,
      destinoHijos: e.destinoHijos,
      posicion: e.posicion,
    })),
  );
}

describe("arrastrar una sección", () => {
  it("subiendo: el documento guardado es el orden del lienzo", async () => {
    // «Tres» (idx 2) sube por encima del punto medio de «Uno».
    const { lienzo, ediciones } = await arrastrar(2, -350);

    expect(lienzo, "el arrastre no movió nada").toEqual(["Tres", "Uno", "Dos", "Cuatro"]);
    expect(ediciones.length, "el arrastre no mandó una sola edición").toBe(1);

    const r = guardado(ediciones);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(orden(r.html), "lo guardado no es lo que enseña el lienzo").toEqual(lienzo);
    expect(r.html.split("<section").length - 1, "se perdió o duplicó una sección").toBe(4);
  }, 120_000);

  it("bajando: el documento guardado es el orden del lienzo", async () => {
    // «Uno» (idx 0) baja del todo, por debajo del punto medio de «Cuatro».
    const { lienzo, ediciones } = await arrastrar(0, 700);

    expect(lienzo, "el arrastre no movió nada").toEqual(["Dos", "Tres", "Cuatro", "Uno"]);
    expect(ediciones.length, "el arrastre no mandó una sola edición").toBe(1);

    const r = guardado(ediciones);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(orden(r.html), "lo guardado no es lo que enseña el lienzo").toEqual(lienzo);
    expect(r.html.split("<section").length - 1, "se perdió o duplicó una sección").toBe(4);
  }, 120_000);

  it("con el dedo: la pulsacion larga arrastra, y guarda lo mismo", async () => {
    const { lienzo, ediciones, armado, eventos } = await arrastrarConElDedo(2, -350);

    // Primero que el gesto EXISTA: sin pulsación larga no hay arrastre táctil
    // y el resto de la sonda pasaría en verde sin haber movido un dedo.
    expect(armado, "la pulsacion larga no armó el arrastre").toBe(true);
    // 🔴 Y que el dedo llegue al final. Sin `touch-action: none` en el asa,
    // Chrome se lleva el toque como scroll en cuanto el dedo se mueve y el
    // gesto muere en `pointercancel` — medido el 19/09/2026, la seccion no se
    // movia. Este es el sintoma exacto, y dice por que si vuelve.
    expect(eventos.join(" "), "el gesto tactil murio en pointercancel").not.toContain(
      "pointercancel",
    );
    expect(eventos.join(" "), "el dedo no llego a soltar").toContain("pointerup:");
    expect(lienzo, "el arrastre con el dedo no movió nada").toEqual([
      "Tres",
      "Uno",
      "Dos",
      "Cuatro",
    ]);
    expect(ediciones.length, "el arrastre no mandó una sola edición").toBe(1);

    const r = guardado(ediciones);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(orden(r.html), "lo guardado no es lo que enseña el lienzo").toEqual(lienzo);
    expect(r.html.split("<section").length - 1, "se perdió o duplicó una sección").toBe(4);
  }, 120_000);
});

// ── Bloques DENTRO de una sección ───────────────────────────────────────────
// Otra superficie, otro mensaje (`source: "block-move"`), y la misma pregunta:
// ¿el documento guardado dice lo que enseña el lienzo?

const DOC_BLOQUES =
  "<!doctype html><html><head><title>t</title>" +
  "<style>body{margin:0}section{padding:20px}h2,p{margin:0 0 16px;min-height:40px}</style>" +
  "</head><body data-openlen-edit-mode>" +
  '<section><div class="envoltorio"><h2>Titular</h2><p>Parrafo A</p><p>Parrafo B</p></div></section>' +
  "<section><h2>Otra seccion</h2></section>" +
  "</body></html>";

/** Pasa el ratón por un bloque y pulsa la flecha de su pastilla. */
async function moverBloque(selector: string, act: "up" | "down") {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(injectSectionReorder(DOC_BLOQUES));
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
    await page.setViewport({ width: 900, height: 800 });
    await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });
    await page.evaluate(`(() => {
      window.__ediciones = [];
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'openlen:edit') window.__ediciones.push(e.data);
      });
    })()`);

    const p = (await page.evaluate(`(() => {
      var el = document.querySelector('${selector}');
      var r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)) as { x: number; y: number };
    await page.mouse.move(p.x, p.y);
    await new Promise((r) => setTimeout(r, 300));

    const boton = (await page.evaluate(`(() => {
      var c = document.querySelector('.openlen-block-chip');
      if (!c || !c.classList.contains('visible')) return null;
      var b = c.querySelector('button[data-block-act="${act}"]');
      if (!b) return null;
      var r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)) as { x: number; y: number } | null;
    if (!boton) throw new Error("la pastilla del bloque no apareció");
    await page.mouse.click(boton.x, boton.y);
    await new Promise((r) => setTimeout(r, 400));

    const lienzo = (await page.evaluate(`(() => {
      return [].slice.call(document.querySelectorAll('.envoltorio > *')).map(function (n) {
        return n.textContent.trim();
      });
    })()`)) as string[];
    const ediciones = (await page.evaluate("window.__ediciones")) as Edicion[];
    return { lienzo, ediciones };
  } finally {
    await browser.close();
    srv.close();
  }
}

function bloquesDe(html: string): string[] {
  const m = html.match(/<div class="envoltorio">([\s\S]*?)<\/div>/);
  if (!m) return [];
  return [...m[1]!.matchAll(/<(?:h2|p)[^>]*>([^<]*)<\/(?:h2|p)>/gi)].map((x) => x[1]!.trim());
}

describe("mover un bloque dentro de su seccion", () => {
  it("subiendolo: el documento guardado es el orden del lienzo", async () => {
    const { lienzo, ediciones } = await moverBloque(".envoltorio > p:nth-of-type(2)", "up");

    expect(lienzo, "el bloque no subió").toEqual(["Titular", "Parrafo B", "Parrafo A"]);
    expect(ediciones.length, "no salió una sola edición").toBe(1);

    const r = guardado(ediciones, DOC_BLOQUES);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(bloquesDe(r.html), "lo guardado no es lo que enseña el lienzo").toEqual(lienzo);
  }, 120_000);

  it("bajandolo: el documento guardado es el orden del lienzo", async () => {
    const { lienzo, ediciones } = await moverBloque(".envoltorio > h2", "down");

    expect(lienzo, "el bloque no bajó").toEqual(["Parrafo A", "Titular", "Parrafo B"]);
    expect(ediciones.length, "no salió una sola edición").toBe(1);

    const r = guardado(ediciones, DOC_BLOQUES);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(bloquesDe(r.html), "lo guardado no es lo que enseña el lienzo").toEqual(lienzo);
  }, 120_000);
});
