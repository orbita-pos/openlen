import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/html-ops";
import {
  HEAD_OP_TARGET,
  MODEL_CSS_ATTR,
  STYLES_OP_TARGET,
  applyHeadOp,
  applyStylesOp,
  documentOpAviso,
  readModelCss,
  splitDocumentOps,
} from "./document-ops";

const op = (o: Partial<Op> & Pick<Op, "target">): Op => ({ type: "replace", ...o });

const PAGINA = `<!doctype html><html><head><style>h1{font-family:'Syne',sans-serif}</style></head><body><h1>Hola</h1></body></html>`;
const FUENTE = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap">`;

describe("el reparto de ops reservadas", () => {
  it("no toca una tanda normal", () => {
    const ops = [op({ target: "a4", newHtml: "<p>x</p>" }), op({ target: "b2" })];
    const r = splitDocumentOps(ops);
    expect(r.domOps).toHaveLength(2);
    expect(r.styles.kind).toBe("ninguna");
    expect(r.head.kind).toBe("ninguna");
  });

  it("aparta el CSS y deja pasar el resto", () => {
    const r = splitDocumentOps([
      op({ target: "a4", newHtml: "<p>x</p>" }),
      op({ target: STYLES_OP_TARGET, type: "insert_after", newHtml: "h1{color:red}" }),
    ]);
    expect(r.domOps.map((o) => o.target)).toEqual(["a4"]);
    expect(r.styles).toEqual({ kind: "css", css: "h1{color:red}", modo: "anadir" });
  });

  // Toda op de `replace` lleva un elemento, así que el `<style>` entero es lo
  // natural. Tolerarlo cuesta una comprobación y evita perder un cambio bueno.
  it("tolera el <style> entero, no sólo el CSS pelado", () => {
    const r = splitDocumentOps([
      op({ target: STYLES_OP_TARGET, newHtml: `<style>h1{color:red}</style>` }),
    ]);
    expect(r.styles).toEqual({ kind: "css", css: "h1{color:red}", modo: "reemplazar" });
  });

  it("dos ops contra el mismo objetivo no se fusionan", () => {
    const r = splitDocumentOps([
      op({ target: STYLES_OP_TARGET, newHtml: "a{}" }),
      op({ target: STYLES_OP_TARGET, newHtml: "b{}" }),
    ]);
    expect(r.styles).toEqual({ kind: "error", reason: "varias" });
    // …pero el resto del turno sobrevive.
    expect(r.domOps).toEqual([]);
  });

  it("una tanda que falla NO arrastra las ops del documento", () => {
    const r = splitDocumentOps([
      op({ target: "a4", newHtml: "<p>x</p>" }),
      op({ target: STYLES_OP_TARGET, newHtml: "" }),
    ]);
    expect(r.styles.kind).toBe("error");
    expect(r.domOps.map((o) => o.target)).toEqual(["a4"]);
  });

  it("borrar el CSS no es una op soportada", () => {
    const r = splitDocumentOps([op({ target: STYLES_OP_TARGET, type: "delete" })]);
    expect(r.styles).toEqual({ kind: "error", reason: "op_no_soportada" });
  });
});

describe("lo que NO puede entrar por estos objetivos", () => {
  // El agujero que importa: un <script> por aquí viajaría sin cápsula y sin
  // sellado CSP. Ese camino es target="runtime" y no tiene atajo.
  it("un script disfrazado de CSS se rechaza", () => {
    const r = splitDocumentOps([
      op({ target: STYLES_OP_TARGET, newHtml: `h1{}</style><script>alert(1)</script>` }),
    ]);
    expect(r.styles).toEqual({ kind: "error", reason: "no_permitido" });
  });

  it("un script en la cabecera se rechaza", () => {
    const r = splitDocumentOps([
      op({ target: HEAD_OP_TARGET, type: "insert_after", newHtml: `<script src="//x.com/a.js"></script>` }),
    ]);
    expect(r.head).toEqual({ kind: "error", reason: "no_permitido" });
  });

  it("<base> se rechaza — reescribiría TODOS los enlaces de la página", () => {
    const r = splitDocumentOps([
      op({ target: HEAD_OP_TARGET, type: "insert_after", newHtml: `<base href="https://otro.com/">` }),
    ]);
    expect(r.head).toEqual({ kind: "error", reason: "no_permitido" });
  });

  it("un <link> a un host cualquiera se rechaza", () => {
    const r = splitDocumentOps([
      op({ target: HEAD_OP_TARGET, type: "insert_after", newHtml: `<link rel="stylesheet" href="https://cdn.malo.com/x.css">` }),
    ]);
    expect(r.head).toEqual({ kind: "error", reason: "no_permitido" });
  });

  it("si UNO de los nodos no pasa, no pasa ninguno", () => {
    const r = splitDocumentOps([
      op({ target: HEAD_OP_TARGET, type: "insert_after", newHtml: `${FUENTE}<meta http-equiv="refresh" content="0">` }),
    ]);
    expect(r.head.kind).toBe("error");
  });

  it("el marcador reservado del editor se rechaza", () => {
    const r = splitDocumentOps([
      op({ target: STYLES_OP_TARGET, newHtml: `h1{}/* data-slot-path= */` }),
    ]);
    expect(r.styles).toEqual({ kind: "error", reason: "marcador_de_editor" });
  });

  it("reemplazar la cabecera entera se rechaza", () => {
    const r = splitDocumentOps([op({ target: HEAD_OP_TARGET, type: "replace", newHtml: FUENTE })]);
    expect(r.head).toEqual({ kind: "error", reason: "op_no_soportada" });
  });
});

describe("cómo aterriza en el documento", () => {
  it("el bloque del modelo nace el ÚLTIMO del <head> — a igual peso, gana", () => {
    const out = applyStylesOp(PAGINA, { kind: "css", css: "h1{font-family:Fraunces,serif}", modo: "anadir" });
    expect(out.indexOf(MODEL_CSS_ATTR)).toBeGreaterThan(out.indexOf("'Syne'"));
    expect(out.indexOf("</head>")).toBeGreaterThan(out.indexOf(MODEL_CSS_ATTR));
  });

  it("añadir concatena; el CSS de la plantilla no se toca", () => {
    const uno = applyStylesOp(PAGINA, { kind: "css", css: "a{color:red}", modo: "anadir" });
    const dos = applyStylesOp(uno, { kind: "css", css: "b{color:blue}", modo: "anadir" });
    expect(readModelCss(dos)).toBe("a{color:red}\nb{color:blue}");
    expect(dos).toContain("'Syne'");
    // Un solo bloque, no dos.
    expect(dos.split(MODEL_CSS_ATTR)).toHaveLength(2);
  });

  it("reemplazar pisa SÓLO el bloque del modelo", () => {
    const uno = applyStylesOp(PAGINA, { kind: "css", css: "a{color:red}", modo: "anadir" });
    const dos = applyStylesOp(uno, { kind: "css", css: "c{color:green}", modo: "reemplazar" });
    expect(readModelCss(dos)).toBe("c{color:green}");
    expect(dos).not.toContain("a{color:red}");
    expect(dos).toContain("'Syne'");
  });

  it("una op fallida deja el documento IDÉNTICO", () => {
    expect(applyStylesOp(PAGINA, { kind: "error", reason: "vacio" })).toBe(PAGINA);
    expect(applyHeadOp(PAGINA, { kind: "error", reason: "no_permitido" })).toBe(PAGINA);
    expect(applyStylesOp(PAGINA, { kind: "ninguna" })).toBe(PAGINA);
  });

  it("la hoja de fuentes entra una vez, aunque se pida dos", () => {
    const uno = applyHeadOp(PAGINA, { kind: "nodos", html: FUENTE });
    expect(uno).toContain("family=Fraunces");
    const dos = applyHeadOp(uno, { kind: "nodos", html: FUENTE });
    expect(dos).toBe(uno);
  });

  it("un documento sin </head> no pierde el bloque", () => {
    const suelto = `<html><body><h1>x</h1></body></html>`;
    const out = applyStylesOp(suelto, { kind: "css", css: "h1{color:red}", modo: "anadir" });
    expect(out).toContain("h1{color:red}");
    expect(out.indexOf(MODEL_CSS_ATTR)).toBeLessThan(out.indexOf("<body"));
  });
});

// El interruptor tiene que mover las TRES mitades: si apaga el reparto pero el
// prompt sigue anunciando el objetivo, el modelo lo emite y desaparece — peor
// que no tenerlo. (Las otras dos mitades se fijan en catalog.test.ts.)
describe("OPENLEN_DOC_OPS=0", () => {
  const ops = [
    op({ target: "a4", newHtml: "<p>x</p>" }),
    op({ target: STYLES_OP_TARGET, type: "insert_after", newHtml: "h1{color:red}" }),
    op({ target: HEAD_OP_TARGET, type: "insert_after", newHtml: FUENTE }),
  ];

  it("no aparta nada: las ops caen al aplicador como antes de que existiera", () => {
    const r = splitDocumentOps(ops, { OPENLEN_DOC_OPS: "0" });
    expect(r.domOps).toHaveLength(3);
    expect(r.styles).toEqual({ kind: "ninguna" });
    expect(r.head).toEqual({ kind: "ninguna" });
  });

  it("cualquier otro valor lo deja encendido", () => {
    for (const v of ["1", "", undefined, "si"]) {
      expect(splitDocumentOps(ops, { OPENLEN_DOC_OPS: v }).domOps).toHaveLength(1);
    }
  });
});

describe("el aviso al usuario", () => {
  it("dice qué pasó, en español, y que lo demás sí se guardó", () => {
    expect(documentOpAviso("styles", "demasiado_grande")).toContain("16 KiB");
    expect(documentOpAviso("head", "no_permitido")).toContain("fuentes de Google");
    expect(documentOpAviso("styles", "varias")).toContain("El resto de la edición sí se guardó");
  });
});
