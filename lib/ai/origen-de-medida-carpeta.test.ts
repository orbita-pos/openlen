// @vitest-environment node
//
// LOS OJOS DE LEN CARGAN LA CARPETA (pieza 9 de Len 2.5). Una página que trae
// `<script src="/js/app.js">` se mide en el Chromium del servidor: si ese
// fichero no llega, Len ve una página rota que en la publicada funciona. El
// origen de medida contesta los ficheros del documento que los pidió, desde
// memoria, como los contestaría la publicada.
import { describe, expect, it } from "vitest";
import { localResponseFor, origenDeMedida } from "./origen-de-medida";

describe("los ficheros de la carpeta en el origen de medida", () => {
  it("🔴 contesta la ruta desde la raíz y la relativa al documento, con su tipo", async () => {
    const o = await origenDeMedida();
    const doc = o.publicar("<h1>x</h1>", { files: { "/js/app.js": "console.log(1)", "/data/menu.json": "[]" } });
    try {
      const base = `http://${o.origin}`;
      const id = new URL(doc.url).pathname.split("/")[1]!;
      expect(localResponseFor(`${base}/js/app.js`, doc.url)).toEqual({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: "console.log(1)",
      });
      expect(localResponseFor(`${base}/${id}/data/menu.json`, doc.url)?.body).toBe("[]");
      expect(localResponseFor(`${base}/${id}/data/menu.json?v=2`, doc.url)?.body).toBe("[]");
    } finally {
      doc.soltar();
    }
  });

  it("lo que no existe, lo que no se publica, otro origen o el propio documento: no contesta (sigue a la red)", async () => {
    const o = await origenDeMedida();
    const doc = o.publicar("<h1>x</h1>", { files: { "/js/app.js": "1", "/tests/a.spec.ts": "t" } });
    try {
      const base = `http://${o.origin}`;
      const id = new URL(doc.url).pathname.split("/")[1]!;
      expect(localResponseFor(`${base}/js/otro.js`, doc.url)).toBeNull();
      expect(localResponseFor(`${base}/tests/a.spec.ts`, doc.url)).toBeNull();
      expect(localResponseFor(`https://otro.com/js/app.js`, doc.url)).toBeNull();
      expect(localResponseFor(`${base}/${id}/`, doc.url)).toBeNull();
      expect(localResponseFor(`${base}/js/app.js`, "about:blank")).toBeNull();
    } finally {
      doc.soltar();
    }
  });

  it("🔴 la página de un slug: lo relativo se resuelve desde su carpeta, como en la publicada", async () => {
    const o = await origenDeMedida();
    const doc = o.publicar("<h1>menu</h1>", { files: { "/js/app.js": "1", "/menu/datos.json": "[]" }, pagina: "menu" });
    try {
      expect(new URL(doc.url).pathname).toMatch(/^\/[^/]+\/menu\/$/);
      const relativo = new URL("datos.json", doc.url).href;
      expect(localResponseFor(relativo, doc.url)?.body).toBe("[]");
      expect(localResponseFor(new URL("js/app.js", doc.url).href, doc.url)).toBeNull();
      expect(localResponseFor(new URL("../js/app.js", doc.url).href, doc.url)?.body).toBe("1");
    } finally {
      doc.soltar();
    }
  });

  it("al soltar el documento, sus ficheros se van con él", async () => {
    const o = await origenDeMedida();
    const doc = o.publicar("<h1>x</h1>", { files: { "/js/app.js": "1" } });
    doc.soltar();
    expect(localResponseFor(`http://${o.origin}/js/app.js`, doc.url)).toBeNull();
  });

  it("el servidor sirve el documento de un slug en su ruta", async () => {
    const o = await origenDeMedida();
    const doc = o.publicar("<h1>menu</h1>", { pagina: "menu" });
    try {
      const res = await fetch(doc.url);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<h1>menu</h1>");
    } finally {
      doc.soltar();
    }
  });
});
