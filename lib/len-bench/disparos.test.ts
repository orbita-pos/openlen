// lib/len-bench/disparos.test.ts — las pruebas de disparo, sin modelo: $0.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import {
  cargarConsultas,
  cargarDisparos,
  cuentas,
  informe,
  leerConsulta,
  leerFrontmatter,
  lineaDeTotal,
  MINIMO_DE_CONSULTAS,
  salidaDeDisparos,
  veredicto,
  type ConsultaDeDisparo,
  type ResultadoDeDisparo,
} from "./disparos";

const md = (query: string, debe: string, notas = "") => `---\nquery: ${query}\nshould_trigger: ${debe}\n---\n${notas}`;

describe("leerConsulta — su frontmatter, su esquema y sus notas", () => {
  it("lee query, should_trigger y lo de debajo como notas", () => {
    const r = leerConsulta("a.md", md('"¿cuánta gente entró ayer?"', "true", "Notas del caso.\n"));
    expect(r).toEqual({ ok: true, consulta: { fichero: "a.md", query: "¿cuánta gente entró ayer?", shouldTrigger: true, notas: "Notas del caso." } });
  });

  it("aguanta BOM y CRLF, que es como sale un fichero del checkout en Windows", () => {
    const r = leerConsulta("a.md", `﻿${md('"¿hola?"', "false")}`.replace(/\n/g, "\r\n"));
    expect(r).toEqual({ ok: true, consulta: { fichero: "a.md", query: "¿hola?", shouldTrigger: false } });
  });

  it("comillas simples y texto llano también son texto", () => {
    expect(leerConsulta("a.md", md("'it''s'", "true"))).toMatchObject({ ok: true, consulta: { query: "it's" } });
    expect(leerConsulta("a.md", md("¿tengo mensajes nuevos?  # comentario", "true"))).toMatchObject({ ok: true, consulta: { query: "¿tengo mensajes nuevos?" } });
  });

  it("sin frontmatter, su aviso", () => {
    expect(leerConsulta("a.md", "query: hola\n")).toEqual({
      ok: false,
      aviso: "a.md: falta el frontmatter de YAML (se esperaba ---\\nquery: …\\nshould_trigger: …\\n---).",
    });
  });

  it("should_trigger entre comillas es texto, no booleano: se rechaza", () => {
    expect(leerConsulta("a.md", md('"hola"', '"true"'))).toEqual({ ok: false, aviso: "a.md: should_trigger: tiene que ser true o false, sin comillas" });
  });

  it("dice todo lo que le falta, no sólo lo primero", () => {
    expect(leerConsulta("a.md", "---\nnotas: x\n---\n")).toEqual({ ok: false, aviso: "a.md: query: falta; should_trigger: falta" });
    expect(leerConsulta("a.md", md('""', "true"))).toEqual({ ok: false, aviso: "a.md: query: está vacía" });
  });

  it("un «: » sin comillas es YAML no válido, como en un lector de verdad", () => {
    const r = leerConsulta("a.md", md("cambia el horario: abrimos de 8 a 8", "false"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.aviso).toMatch(/^a\.md: YAML no válido — query: un valor sin comillas no puede llevar «: »/);
  });
});

describe("leerFrontmatter — lo justo, y dice lo que no entiende", () => {
  it("rechaza listas, bloques y claves repetidas", () => {
    expect(leerFrontmatter("query:\n  - a")).toMatchObject({ ok: false, motivo: expect.stringMatching(/sólo entiende «clave: valor»/) });
    expect(leerFrontmatter("query: |")).toMatchObject({ ok: false, motivo: expect.stringMatching(/^query: «\|»/) });
    expect(leerFrontmatter("a: 1\na: 2")).toEqual({ ok: false, motivo: "«a» aparece dos veces" });
  });
});

describe("cargarConsultas — una carpeta, con sus avisos", () => {
  let dir = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("sin carpeta, su aviso con el mínimo", () => {
    const r = cargarConsultas(path.join(os.tmpdir(), "no-existe-len-bench-disparos"));
    expect(r.consultas).toEqual([]);
    expect(r.avisos[0]).toMatch(new RegExp(`^No hay carpeta de disparos en .+\\. Crea una con al menos ${MINIMO_DE_CONSULTAS} <nombre>\\.md \\(frontmatter: query, should_trigger\\)\\.$`));
  });

  it("un fichero roto no tumba la carpeta; en orden de nombre; y avisa si son menos de cinco", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "disparos-"));
    fs.writeFileSync(path.join(dir, "b.md"), md('"dos"', "false"));
    fs.writeFileSync(path.join(dir, "a.md"), md('"uno"', "true"));
    fs.writeFileSync(path.join(dir, "roto.md"), "sin frontmatter");
    fs.writeFileSync(path.join(dir, "leeme.txt"), "no es una consulta");
    const r = cargarConsultas(dir);
    expect(r.consultas.map((c) => c.fichero)).toEqual(["a.md", "b.md"]);
    expect(r.avisos).toEqual([
      expect.stringMatching(/^roto\.md: falta el frontmatter/),
      "Sólo hay 2 consultas; se recomiendan al menos 5 para que la cobertura diga algo.",
    ]);
  });
});

describe("veredicto — pasa si (llamó) === should_trigger", () => {
  it("las cuatro esquinas", () => {
    expect(veredicto(true, ["ver_visitas"], "ver_visitas")).toEqual({ llamo: true, veredicto: "pasa" });
    expect(veredicto(true, ["ver_mensajes"], "ver_visitas")).toEqual({ llamo: false, veredicto: "falla" });
    expect(veredicto(false, [], "ver_visitas")).toEqual({ llamo: false, veredicto: "pasa" });
    // Llamar DE MÁS también falla: es lo que miden los casi-aciertos.
    expect(veredicto(false, ["ver_formularios", "ver_visitas"], "ver_visitas")).toEqual({ llamo: true, veredicto: "falla" });
  });
});

describe("el informe, con la forma del suyo", () => {
  const c = (fichero: string, shouldTrigger: boolean): ConsultaDeDisparo => ({ fichero, query: fichero, shouldTrigger });
  const resultados: ResultadoDeDisparo[] = [
    { consulta: c("ayer.md", true), llamo: true, veredicto: "pasa", motivo: "llamó a ver_visitas", usd: 0.004 },
    { consulta: c("contador.md", false), llamo: true, veredicto: "falla", motivo: "llamó a ver_visitas, editar", usd: 0.02 },
    { consulta: c("mes.md", true), llamo: null, veredicto: "saltada", motivo: "tope de gasto", usd: 0 },
  ];

  it("una línea por consulta, el motivo bajo cada fallo y el total", () => {
    const texto = informe({ herramienta: "ver_visitas", dir: "d/ver_visitas", consultas: resultados.map((r) => r.consulta), avisos: ["Sólo hay 3 consultas"], resultados });
    expect(texto.split("\n")).toEqual([
      "Evaluando ver_visitas (d/ver_visitas)",
      "",
      "! Sólo hay 3 consultas",
      "",
      "Pruebas de disparo:",
      "  [PASA   ] ayer.md — debía llamar, llamó",
      "  [FALLA  ] contador.md — no debía llamar, llamó",
      "            llamó a ver_visitas, editar",
      "  [SALTADA] mes.md — debía llamar",
      "",
      "1/2 pruebas de disparo pasaron (1 saltada).",
    ]);
  });

  it("sin consultas lo dice y no inventa un total", () => {
    expect(informe({ herramienta: "x", dir: "d/x", consultas: [], avisos: [], resultados: [] })).toBe("Evaluando x (d/x)\n\nNo hay consultas que correr.");
  });

  it("la salida: 1 si falla alguna, 2 si el tope dejó consultas sin correr", () => {
    expect(cuentas(resultados)).toEqual({ pasan: 1, fallan: 1, saltadas: 1 });
    expect(lineaDeTotal({ pasan: 3, fallan: 0, saltadas: 0 })).toBe("3/3 pruebas de disparo pasaron.");
    expect(salidaDeDisparos({ fallan: 0, saltadas: 0 })).toBe(0);
    expect(salidaDeDisparos({ fallan: 1, saltadas: 0 })).toBe(1);
    expect(salidaDeDisparos({ fallan: 0, saltadas: 1 })).toBe(2);
  });
});

describe("las carpetas de verdad (lib/len-bench/disparos/)", () => {
  const carpetas = cargarDisparos(path.join(__dirname, "disparos"));

  it("cada carpeta nombra una herramienta que Len tiene: si no, cada «debía llamar» fallaría sin medir nada", () => {
    const deLen = new Set(buildFunctionDeclarations().map((d) => String(d.name)));
    expect(carpetas.map((c) => c.herramienta).filter((h) => !deLen.has(h))).toEqual([]);
    expect(carpetas.map((c) => c.herramienta)).toEqual(["ver_formularios", "ver_mensajes", "ver_visitas"]);
  });

  it("se leen sin un aviso, con al menos cinco consultas y casi-aciertos en cada una", () => {
    for (const c of carpetas) {
      expect(c.avisos, c.herramienta).toEqual([]);
      expect(c.consultas.length, c.herramienta).toBeGreaterThanOrEqual(MINIMO_DE_CONSULTAS);
      expect(c.consultas.some((x) => !x.shouldTrigger), c.herramienta).toBe(true);
    }
  });
});
