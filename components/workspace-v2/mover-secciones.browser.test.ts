// REORDENAR SIN DUPLICAR NI PERDER, con un navegador de verdad.
//
// Mover una sección es la edición más peligrosa del taller. Un texto que
// aterriza en el elemento equivocado se ve y se corrige; una sección que se
// duplica —o que desaparece— es la página del usuario rota.
//
// El peligro concreto: la ruta es POSICIONAL. Si el movimiento se partiera en
// un borrado y una inserción, en cuanto la primera mitad se aplicara los
// índices `nth-of-type` de la segunda ya no serían los que el navegador
// calculó. Por eso viaja como UNA operación y el servidor resuelve las dos
// rutas contra el mismo documento.
//
// Esta prueba mide la junta entera: Chromium construye las rutas sobre el DOM
// vivo —con los cinco inyectores del editor encima, que cuelgan sus propios
// nodos— y el motor Rust las resuelve contra el documento guardado.
import { describe, expect, it, afterAll } from "vitest";
import { createServer, type Server } from "node:http";

import { buildEditPath, editChildTags } from "./edit-path";
import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { injectInlineEdit } from "./use-inline-edit";
import { injectSectionInsert } from "./use-section-insert";
import { injectSectionReorder } from "./use-section-reorder";
import { aplicarEdiciones } from "@/lib/page-engine/aplicar-ediciones";

const DOC =
  "<!doctype html><html><head><title>t</title></head><body>" +
  "<main>" +
  "<section><h2>Portafolio</h2><p>uno</p></section>" +
  "<section><h2>Artistas</h2><p>dos</p></section>" +
  "<section><h2>Cuidados</h2><p>tres</p></section>" +
  "</main>" +
  "</body></html>";

const CON_EDITOR = injectSectionInsert(
  injectSectionReorder(injectElementInspect(injectImageReplace(injectInlineEdit(DOC)))),
);

let server: Server | null = null;
afterAll(() => server?.close());

/** El orden de los titulares en un documento, tal y como se lee. */
function orden(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/gi)].map((m) => m[1]!.trim());
}

describe("mover una sección con las rutas que calcula el navegador", () => {
  it("cambia el orden sin duplicar ni perder ninguna", async () => {
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
      await page.goto(`http://127.0.0.1:${dir.port}/`, { waitUntil: "load", timeout: 20_000 });

      // Las rutas, calculadas EN CHROMIUM con las mismas funciones que se
      // serializan dentro del inyector.
      const secciones = (await page.evaluate(
        `(() => {
          var buildEditPath = ${buildEditPath.toString()};
          var editChildTags = ${editChildTags.toString()};
          return [].slice.call(document.querySelectorAll('main > section')).map(function (el) {
            return {
              path: buildEditPath(el),
              tag: el.tagName.toLowerCase(),
              hijos: editChildTags(el),
              titulo: el.querySelector('h2').textContent
            };
          });
        })()`,
      )) as Array<{ path: string; tag: string; hijos: string[]; titulo: string }>;

      expect(secciones.map((s) => s.titulo)).toEqual([
        "Portafolio",
        "Artistas",
        "Cuidados",
      ]);

      // Cuidados sube por encima de Artistas — la flecha ↑ de su barra.
      const cuidados = secciones[2]!;
      const artistas = secciones[1]!;
      const r = aplicarEdiciones(DOC, [
        {
          op: "mover",
          path: cuidados.path,
          tag: cuidados.tag,
          hijos: cuidados.hijos,
          destino: artistas.path,
          destinoTag: artistas.tag,
          destinoHijos: artistas.hijos,
          posicion: "antes",
        },
      ]);

      expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
      if (!r.ok) return;
      expect(orden(r.html)).toEqual(["Portafolio", "Cuidados", "Artistas"]);
      // Ni una copia ni un hueco: siguen siendo tres.
      expect(r.html.split("<section").length - 1).toBe(3);
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 90_000);
});
