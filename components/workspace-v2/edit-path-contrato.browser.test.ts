// EL CONTRATO ENTRE LAS DOS ORILLAS, CON UN NAVEGADOR DE VERDAD.
//
// Una edición del taller viaja como una RUTA POSICIONAL: el iframe la construye
// sobre el DOM vivo (Chromium) y el servidor la resuelve contra el documento
// guardado (el motor Rust). Son dos implementaciones distintas de «qué elemento
// es éste», y si se desincronizan la edición aterriza en el elemento
// equivocado, callada.
//
// Las pruebas de `edit-path.test.ts` corren en jsdom y miden la función sola.
// Ésta mide LA JUNTA: se inyectan los cinco scripts del editor —que cuelgan sus
// propios nodos en la página—, se calculan las rutas en Chromium, y se aplican
// de verdad con `aplicarEdiciones`. Si el editor desplazara un índice, o si el
// resolutor de Rust contara distinto, aquí se ve.
import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import {
  buildEditPath,
  editChildTags,
  isEditorNode,
  EDITOR_NODE_ATTRS,
} from "./edit-path";
import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { injectInlineEdit } from "./use-inline-edit";
import { injectSectionInsert } from "./use-section-insert";
import { injectSectionReorder } from "./use-section-reorder";
import { aplicarEdiciones } from "@/lib/page-engine/aplicar-ediciones";

/** Un documento con las trampas que de verdad rompen una ruta posicional:
 *  hermanos del mismo tipo, tipos mezclados, y anidamiento. */
const DOC =
  "<!doctype html><html><head><title>t</title></head><body>" +
  "<header><h1>Titular</h1><nav><a href=#>Uno</a><a href=#>Dos</a></nav></header>" +
  "<main>" +
  "<section><h2>Primera</h2><p>a</p><p>b</p></section>" +
  "<section><h2>Segunda</h2><div><p>c</p></div></section>" +
  "</main>" +
  "<footer><p>pie</p></footer>" +
  "</body></html>";

/** El documento tal y como el lienzo lo sirve: con los cinco inyectores. */
const CON_EDITOR = injectSectionInsert(
  injectSectionReorder(injectElementInspect(injectImageReplace(injectInlineEdit(DOC)))),
);

let server: Server | null = null;

describe("la ruta que construye el iframe resuelve al MISMO elemento en el servidor", () => {
  it("para cada elemento de la página, con el editor inyectado encima", async () => {
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
      await page.goto(`http://127.0.0.1:${dir.port}/`, {
        waitUntil: "load",
        timeout: 20_000,
      });

      // Las rutas se calculan EN CHROMIUM, con las mismas funciones que se
      // serializan dentro de los scripts del iframe.
      const objetivos = (await page.evaluate(
        `(() => {
          var buildEditPath = ${buildEditPath.toString()};
          var EDITOR_NODE_ATTRS = ${JSON.stringify(EDITOR_NODE_ATTRS)};
          var isEditorNode = ${isEditorNode.toString()};
          var editChildTags = ${editChildTags.toString()};
          var out = [];
          var todos = document.body.querySelectorAll('h1,h2,p,a,section,div,nav,footer,header');
          for (var i = 0; i < todos.length; i++) {
            var el = todos[i];
            if (isEditorNode(el)) continue;
            out.push({
              path: buildEditPath(el),
              tag: el.tagName.toLowerCase(),
              hijos: editChildTags(el),
              texto: (el.textContent || '').trim().slice(0, 20)
            });
          }
          return out;
        })()`,
      )) as Array<{ path: string; tag: string; hijos: string[]; texto: string }>;

      // Si el documento cambiara y esto midiera cuatro elementos, pasaría en
      // verde sin comprobar nada.
      expect(objetivos.length).toBeGreaterThan(10);

      for (const o of objetivos) {
        const marca = "__AQUI_" + o.path.replace(/[^a-z0-9]/gi, "") + "__";
        const r = aplicarEdiciones(DOC, [
          {
            op: "replace",
            path: o.path,
            tag: o.tag,
            hijos: o.hijos,
            html: `<${o.tag}>${marca}</${o.tag}>`,
          },
        ]);
        expect(r.ok, `la ruta ${o.path} fue rechazada`).toBe(true);
        if (!r.ok) continue;

        // Y aterrizó donde el navegador dijo: el elemento que llevaba ESE texto
        // es el que desapareció.
        expect(r.html, `${o.path} no dejó su marca`).toContain(marca);
        if (o.texto && o.hijos.length === 0) {
          expect(
            r.html.includes(">" + o.texto + "<"),
            `${o.path} sustituyó el elemento equivocado — «${o.texto}» sigue ahí`,
          ).toBe(false);
        }
      }
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 90_000);
});
