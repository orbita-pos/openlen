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
// CUBRE  arrastrar hacia arriba y hacia abajo, y que no se pierda ni se duplique
//        ninguna sección.
// NO CUBRE  el arrastre con el dedo (pulsación larga), los bloques dentro de una
//        sección, ni si la animación FLIP se ve bien.
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

function guardado(ediciones: Edicion[]) {
  return aplicarEdiciones(
    DOC,
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
});
