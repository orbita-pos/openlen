import { describe, expect, it } from "vitest";
import { formaDelTurno, lineaDeForma, type EntradaDeForma } from "./forma-del-turno";

const BASE: EntradaDeForma = {
  projectId: "p1",
  systemPrompt: "x".repeat(32000),
  contextBlock: "y".repeat(60000),
  taggedHtml: '<h1 data-op-id="a">Taller El Norte</h1>',
  vista: "completa",
  history: [{ content: "hola" }, { content: "adios" }],
  prompt: "pon el titular en azul",
};

describe("formaDelTurno", () => {
  it("mide los cuatro trozos y estima el total", () => {
    const f = formaDelTurno(BASE);
    expect(f.sysChars).toBe(32000);
    expect(f.ctxChars).toBe(60000);
    expect(f.histChars).toBe(9);
    expect(f.promptChars).toBe(22);
    expect(f.tokensAprox).toBe(Math.ceil((32000 + 60000 + 9 + 22) / 3.5));
  });

  it("el hash es una etiqueta corta y estable, no el documento", () => {
    const a = formaDelTurno(BASE);
    const b = formaDelTurno({ ...BASE });
    expect(a.docHash).toBe(b.docHash);
    expect(a.docHash).toHaveLength(16);
    // Cambiar un byte del documento cambia la etiqueta: es lo que permite decir
    // «el mismo de antes» entre dos turnos sin arrastrar el documento.
    expect(formaDelTurno({ ...BASE, taggedHtml: BASE.taggedHtml + " " }).docHash).not.toBe(a.docHash);
  });

  it("sin dato de turnos totales, «totales» es lo visible — 0 seria afirmar que no hay conversación", () => {
    expect(formaDelTurno(BASE).histTotales).toBe(2);
    expect(formaDelTurno({ ...BASE, turnosTotales: 12 }).histTotales).toBe(12);
  });

  it("los bloques opcionales se cuentan por presencia REAL, no por si el campo vino", () => {
    const f = formaDelTurno({
      ...BASE,
      userMemory: "   ",
      userBrief: "el tono es formal",
      cambios: [1, 2, 3],
      degradaciones: [1],
      turnoAnteriorMudo: true,
      conPin: true,
    });
    // Una memoria de sólo espacios NO es memoria: el bloque sale vacío del
    // constructor de contexto, y decir que estaba engañaría al que diagnostica.
    expect(f.conMemoria).toBe(false);
    expect(f.conBrief).toBe(true);
    expect(f.cambios).toBe(3);
    expect(f.degradaciones).toBe(1);
    expect(f.mudo).toBe(true);
    expect(f.conPin).toBe(true);
    expect(f.conImagen).toBe(false);
  });

  it("la Home se llama «principal», el mismo nombre que usa trabajar_en_pagina", () => {
    expect(formaDelTurno(BASE).pagina).toBe("principal");
    expect(formaDelTurno({ ...BASE, activePage: "menu" }).pagina).toBe("menu");
  });

  it("las tres vistas viajan tal cual: con «indice» el modelo NO vio el HTML", () => {
    for (const v of ["completa", "recortada", "indice"] as const) {
      expect(formaDelTurno({ ...BASE, vista: v }).vista).toBe(v);
    }
  });
});

describe("lineaDeForma", () => {
  it("una sola línea, en pares clave=valor para grep y awk", () => {
    const linea = lineaDeForma(formaDelTurno(BASE));
    expect(linea).not.toContain("\n");
    expect(linea.startsWith("[agent] forma ")).toBe(true);
    for (const clave of ["proj", "pagina", "vista", "doc", "dochash", "sys", "ctx", "hist", "tok~", "mem", "brief", "cambios", "degr", "mudo", "pin", "img"]) {
      expect(linea).toMatch(new RegExp(`(^| )${clave.replace("~", "\\~")}=`));
    }
  });

  it("los booleanos son 1/0: catorce campos en una línea y hay que poder leerla de un vistazo", () => {
    expect(lineaDeForma(formaDelTurno({ ...BASE, turnoAnteriorMudo: true }))).toContain("mudo=1");
    expect(lineaDeForma(formaDelTurno(BASE))).toContain("mudo=0");
  });

  // 🔴 EL INVARIANTE, y es la razón entera de que esto vaya siempre encendido en
  // vez de tras una palanca: la línea describe la FORMA del turno y no puede
  // llevar dentro NADA del usuario. El día que alguien añada un campo con un
  // fragmento «para que se entienda mejor», esto falla.
  it("NO se escapa contenido del usuario: ni documento, ni prompt, ni brief, ni memoria", () => {
    const linea = lineaDeForma(
      formaDelTurno({
        ...BASE,
        taggedHtml: "<h1>Taller El Norte, calle Mayor 3</h1>",
        prompt: "mi whatsapp es 600111222, ponlo en el pie",
        userBrief: "el dueño se llama Marta",
        userMemory: "nunca uses amarillo",
      }),
    );
    for (const secreto of [
      "Taller El Norte",
      "calle Mayor",
      "600111222",
      "whatsapp",
      "Marta",
      "amarillo",
      "<h1>",
    ]) {
      expect(linea, `se escapó «${secreto}» a la línea de diagnóstico`).not.toContain(secreto);
    }
  });
});
