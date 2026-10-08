// lib/len-bench/casos/dev/pos-de-cafeteria.test.ts — el caso de app, a $0.
//
// Lo que `bench:len:validar` comprueba publicando y abriendo Chromium, aquí
// sólo en lo que no cuesta: que la solución pasa la verificación de la app (el
// compilador de verdad y el cascarón), que las dos rotas de la verificación la
// suspenden por SU fichero, y que las demás compilan —así cada una aísla su
// defecto y no se esconde detrás de una app en blanco—.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isBlankProject } from "@/lib/projects/blank";
import { appVerificadaTrasCadaCambio, problemasDeLaApp } from "@/lib/len-bench/app-verificada";
import type { ContextoDeCalificacion, DatosDelCaso } from "@/lib/len-bench/tipos";
import { crear } from "./pos-de-cafeteria";

const caso = crear();
const problemas = (d: DatosDelCaso) => problemasDeLaApp(d, d.ficheros ?? {});

describe("pos-de-cafeteria — una app que nace y crece por chat", () => {
  it("nace: proyecto en blanco, la tarjeta App en el primer mensaje, y cinco cambios después", () => {
    expect(isBlankProject({ html: caso.inicio.html, pages: caso.inicio.pages, chatTurns: 0 })).toBe(true);
    expect(caso.naceComo).toEqual({ como: "app", idioma: "es" });
    expect(caso.guion.map((p) => p.tipo)).toEqual(["pide", "vuelve", "vuelve", "vuelve", "vuelve", "vuelve"]);
    expect(caso.graders[0]!.nombre).toBe("app-verificada-tras-cada-cambio");
  });

  it("🔴 la solución pasa su propia verificación: compila entera y el cascarón la arranca", () => {
    expect(problemas(caso.solucion)).toEqual([]);
  });

  it("las dos rotas de la verificación la suspenden, cada una por su fichero", () => {
    const rota = (n: string) => caso.rotas.find((r) => r.nombre === n)!.datos;
    expect(problemas(rota("no-compila"))!.join("\n")).toMatch(/\/src\/screens\/Caja\.jsx/);
    expect(problemas(rota("cascaron-sin-entrada"))!.join("\n")).toMatch(/\/index\.html — The shell no longer loads the app/);
  });

  it("las demás rotas COMPILAN: su defecto es el suyo, no una app en blanco", () => {
    const demas = caso.rotas.filter((r) => !["no-compila", "cascaron-sin-entrada"].includes(r.nombre));
    expect(demas.length).toBe(7);
    for (const r of demas) expect(problemas(r.datos), r.nombre).toEqual([]);
  });

  it("ninguna rota es la solución", () => {
    for (const r of caso.rotas) expect(JSON.stringify(r.datos), r.nombre).not.toBe(JSON.stringify(caso.solucion));
  });
});

describe("app-verificada-tras-cada-cambio — en la corrida, lee lo que apuntó el conductor", () => {
  const g = appVerificadaTrasCadaCambio();
  const ctx = (verificaciones: ContextoDeCalificacion["verificaciones"]) => ({ verificaciones }) as unknown as ContextoDeCalificacion;

  it("todos los pasos en verde aprueban", async () => {
    const r = await g.calificar(ctx([0, 1, 2].map((paso) => ({ paso, ok: true, problemas: [] }))));
    expect(r).toMatchObject({ paso: true });
    expect(r.explicacion).toMatch(/tras los 3 pasos/);
  });

  it("🔴 una app rota a MEDIO guion suspende aunque el final compile, y dice en qué paso", async () => {
    const r = await g.calificar(
      ctx([
        { paso: 0, ok: true, problemas: [] },
        { paso: 1, ok: false, problemas: ["/src/screens/Caja.jsx:12 — Unexpected token"] },
        { paso: 2, ok: true, problemas: [] },
      ]),
    );
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/tras el paso 2: \/src\/screens\/Caja\.jsx:12/);
  });

  it("sin ningún paso verificado no aprueba", async () => {
    expect((await g.calificar(ctx([]))).paso).toBe(false);
  });
});
