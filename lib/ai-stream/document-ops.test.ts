import { describe, expect, it } from "vitest";

import type { Op } from "@/lib/html-ops";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import {
  HEAD_OP_TARGET,
  LANG_OP_TARGET,
  RESERVED_TARGETS,
  reservedTargetsBlock,
  applyLangOp,
  splitLangOp,
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
    // Esto exigía la frase «fuentes de Google» a secas, y esa frase MENTÍA: la
    // cabecera acepta además el <title> y tres <meta>. Un rechazo que enumera
    // mal lo permitido manda al modelo a reescribir la página entera.
    expect(documentOpAviso("head", "no_permitido")).toContain("hoja de fuentes");
    expect(documentOpAviso("head", "no_permitido")).toContain("title");
    expect(documentOpAviso("head", "no_permitido")).toContain("description");
    expect(documentOpAviso("styles", "varias")).toContain("El resto de la edición sí se guardó");
  });

  // `idioma` no tenía aviso: una op de idioma rechazada se caía en silencio, y
  // es justo la que impide que una página traducida siga diciendo lang="es".
  it("y ahora también cuando se cae el cambio de IDIOMA", () => {
    const aviso = documentOpAviso("idioma", "no_permitido");
    expect(aviso).toContain("idioma");
    expect(aviso).toContain("pt-BR");
    expect(aviso).toContain("El resto de la edición sí se guardó");
  });
});

// ─── LO QUE ENCONTRARON LOS ATAQUES DE QA (2026-08-22) ──────────────────────
// La primera version limitaba `head` a hojas de fuentes, y `<html>` no era
// alcanzable en absoluto. Dos peticiones normalisimas quedaban rotas y MEDIDAS
// 0 de 3: «cambia el telefono en TODA la pagina» dejaba el viejo en la meta
// description, y «pon la pagina en ingles» dejaba lang="es".

describe("la cabecera: titulo y metadatos", () => {
  it("acepta el <title> y la meta description", () => {
    const r = splitDocumentOps([
      op({
        target: HEAD_OP_TARGET,
        type: "insert_after",
        newHtml: `<meta name="description" content="Clínica Ríos · Tel. 614 555 0198">`,
      }),
    ]);
    expect(r.head.kind).toBe("nodos");
  });

  // Dos titulos o dos descripciones no son un anadido: son un documento roto
  // del que el navegador elige uno y nadie sabe cual.
  it("un <title> REEMPLAZA al que habia, no se duplica", () => {
    const base = `<html><head><title>Viejo</title></head><body>x</body></html>`;
    const out = applyHeadOp(base, { kind: "nodos", html: `<title>Nuevo</title>` });
    expect(out).toContain("<title>Nuevo</title>");
    expect(out).not.toContain("Viejo");
    expect(out.split("<title").length - 1).toBe(1);
  });

  it("una <meta> del mismo name tambien reemplaza", () => {
    const base = `<html><head><meta name="description" content="viejo"></head><body>x</body></html>`;
    const out = applyHeadOp(base, {
      kind: "nodos",
      html: `<meta name="description" content="nuevo">`,
    });
    expect(out).toContain('content="nuevo"');
    expect(out).not.toContain("viejo");
  });

  it("pero un <meta http-equiv> sigue prohibido — es un refresco o una CSP propia", () => {
    const r = splitDocumentOps([
      op({ target: HEAD_OP_TARGET, type: "insert_after", newHtml: `<meta http-equiv="refresh" content="0;url=https://x">` }),
    ]);
    expect(r.head).toEqual({ kind: "error", reason: "no_permitido" });
  });
});

describe("el idioma del documento", () => {
  it("acepta el codigo pelado y el atributo entero", () => {
    for (const bruto of ["en", `lang="pt-BR"`]) {
      const r = splitLangOp([op({ target: LANG_OP_TARGET, newHtml: bruto })]);
      expect(r.lang.kind, bruto).toBe("idioma");
    }
  });

  it("escribe lang en <html>, reemplazando el que hubiera", () => {
    const out = applyLangOp(`<!doctype html><html lang="es"><body>x</body></html>`, {
      kind: "idioma",
      lang: "en",
    });
    expect(out).toContain('<html lang="en">');
    expect(out).not.toContain('lang="es"');
  });

  it("y lo anade cuando no habia", () => {
    expect(applyLangOp(`<html><body>x</body></html>`, { kind: "idioma", lang: "en" }))
      .toContain('<html lang="en"');
  });

  it("cualquier cosa que no sea un codigo se rechaza", () => {
    for (const malo of ["", "javascript:x", "en'><script>", "esto es español"]) {
      expect(splitLangOp([op({ target: LANG_OP_TARGET, newHtml: malo })]).lang.kind, malo).toBe("error");
    }
  });

  it("una tanda sin idioma no toca nada", () => {
    const ops = [op({ target: "a4", newHtml: "<p>x</p>" })];
    const r = splitLangOp(ops);
    expect(r.domOps).toHaveLength(1);
    expect(r.lang).toEqual({ kind: "ninguna" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HALLAZGO 9 — «cuatro copias manuales del mismo contrato».
//
// El parser implementa CUATRO objetivos reservados. El prompt del Chat enseñaba
// TRES, decía que la cabecera sólo admite fuentes, y omitía `idioma` entero; el
// bloque estático remataba diciendo que CSS, fuentes, título y meta description
// «requires MODE B». El catálogo del Agente decía «TRES» y enumeraba cuatro.
//
// MEDIDO contra DeepSeek real el 25/08 (4 llamadas antes, 4 después): con el
// prompt viejo el modelo acertaba 2/4 — fallaba justo los dos objetivos que se
// construyeron para arreglar fallos medidos (el teléfono viejo en la meta
// description y el `lang` al traducir). Con el corregido, 4/4.
//
// Esta prueba no comprueba prosa: comprueba que las TRES superficies nombran
// los mismos objetivos. Un quinto objetivo en el parser que nadie enseñe la
// pone en rojo.
describe("paridad del contrato de objetivos reservados", () => {
  it("el parser reconoce exactamente los objetivos de RESERVED_TARGETS", () => {
    // `runtime` lo aparta `splitRuntimeOps` (su propio módulo); los otros tres
    // salen de aquí. La lista es la unión, y es la que se enseña.
    expect([...RESERVED_TARGETS].sort()).toEqual(
      ["head", "idioma", "runtime", "styles"].sort(),
    );
  });

  it("el bloque del Chat nombra los CUATRO", () => {
    const bloque = reservedTargetsBlock();
    for (const t of RESERVED_TARGETS) {
      expect(bloque, `el prompt del Chat no menciona target="${t}"`).toContain(
        `target="${t}"`,
      );
    }
  });

  // El catálogo del Agente NO siempre enumera los cuatro: desde el hallazgo 1,
  // `runtime` sólo se anuncia donde el piloto de verdad lo permite —
  // interruptor encendido Y documento raíz—. Anunciarlo con el piloto apagado
  // era ofrecerle al modelo una puerta que el límite iba a cerrarle después de
  // gastar el turno. Así que la paridad es CONDICIONAL, y en las dos
  // direcciones: cuando se puede, están los cuatro; cuando no, los tres
  // documentales y `runtime` no aparece por ningún lado.
  // LA PARIDAD SIGUE, PERO CAMBIÓ DE FORMA el 2026-09-03, al partir
  // `editar_pagina` en cuatro. Los tres objetivos documentales siguen siendo
  // `target` —ahora de `editar_html`— y `runtime` dejó de ser un target para
  // ser una HERRAMIENTA. Comprobarlo como antes, buscando `"runtime"` en una
  // sola descripción, habría dado verde en cuanto alguien lo mencionara de
  // pasada y rojo aunque la puerta funcionase: lo que importa es que los cuatro
  // sigan siendo ALCANZABLES desde el Agente, no dónde estén escritos.
  const catalogo = () => buildFunctionDeclarations({ OPENLEN_DOC_OPS: "1" });

  it("con el piloto abierto, el Agente alcanza los CUATRO objetivos reservados", () => {
    const decls = catalogo();
    const html = decls.find((x) => x.name === "editar_html") as { description: string };
    for (const t of RESERVED_TARGETS) {
      if (t === "runtime") {
        // No es un target: es su propia puerta.
        expect(decls.map((x) => x.name)).toContain("editar_runtime");
        continue;
      }
      expect(html.description, `editar_html no menciona "${t}"`).toContain(t);
    }
  });

  // RETIRADA con el interruptor: el target `runtime` se ofrece siempre.

  // RETIRADA la mitad de «las dos variantes»: sólo queda una.

  it("el prompt del Chat enseña TODO lo que la cabecera acepta", () => {
    const bloque = reservedTargetsBlock();
    for (const nodo of ["<title>", "description", "keywords", "author"]) {
      expect(bloque, `la cabecera acepta ${nodo} y el prompt no lo dice`).toContain(nodo);
    }
  });

  it("y el bloque dice POR QUÉ importan los dos que arreglan fallos medidos", () => {
    const bloque = reservedTargetsBlock();
    // No es adorno: sin el motivo, el modelo trata la meta y el lang como
    // opcionales. Con el motivo delante, 4/4.
    expect(bloque).toMatch(/meta description/i);
    expect(bloque).toMatch(/screen reader/i);
  });
});
