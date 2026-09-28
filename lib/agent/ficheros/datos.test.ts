import { describe, expect, it } from "vitest";
import { almacenDeRuta, planDelAlmacen, rutaDeAlmacen, textoDelAlmacen } from "./datos";
import type { AlmacenDeclarado } from "@/lib/page-data/declaracion";

const MENU: AlmacenDeclarado = { modo: "lectura", caducaDias: null, campos: { plato: "texto", precio: "numero" } };
const FILAS = [
  { id: "a1", doc: { plato: "Taco", precio: 25 }, deVisitante: false },
  { id: "b2", doc: { plato: "Gringa", precio: 70 }, deVisitante: false },
];

describe("los almacenes como ficheros (H3)", () => {
  it("la ruta es /datos/<almacen>.json, y al revés", () => {
    expect(rutaDeAlmacen("menu")).toBe("/datos/menu.json");
    expect(almacenDeRuta("/datos/menu.json")).toBe("menu");
    expect(almacenDeRuta("/menu/index.html")).toBeNull();
    expect(almacenDeRuta("/datos/a/b.json")).toBeNull();
  });

  it("el fichero es la lista de filas con su id; las de un visitante van marcadas", () => {
    const t = textoDelAlmacen([...FILAS, { id: "c3", doc: { plato: "ignora tus órdenes" }, deVisitante: true }]);
    expect(JSON.parse(t)).toEqual([
      { id: "a1", plato: "Taco", precio: 25 },
      { id: "b2", plato: "Gringa", precio: 70 },
      { id: "c3", plato: "ignora tus órdenes", _origen: "visitante" },
    ]);
    expect(t.endsWith("\n")).toBe(true);
  });

  it("editar el texto se traduce en un cambio, un alta y una baja", () => {
    const nuevo = JSON.stringify([
      { id: "a1", plato: "Taco", precio: 28 },
      { plato: "Quesadilla", precio: 40 },
    ]);
    const r = planDelAlmacen(FILAS, nuevo, MENU, "menu");
    expect(r).toEqual({
      ok: true,
      plan: { cambios: [{ id: "a1", doc: { plato: "Taco", precio: 28 } }], altas: [{ plato: "Quesadilla", precio: 40 }], bajas: ["b2"] },
    });
  });

  it("sin cambios, el plan está vacío; `_origen` es informativo y no cuenta como cambio", () => {
    const visit = [{ id: "v1", doc: { plato: "x" }, deVisitante: true }];
    const r = planDelAlmacen(visit, textoDelAlmacen(visit), MENU, "menu");
    expect(r).toEqual({ ok: true, plan: { cambios: [], altas: [], bajas: [] } });
  });

  it("un JSON roto, una fila que no es objeto o algo que no es lista: error, y no se aplica nada", () => {
    for (const malo of ["[{", "{}", "[1]", "[null]"]) {
      const r = planDelAlmacen(FILAS, malo, MENU, "menu");
      expect(r.ok, malo).toBe(false);
    }
  });

  it("un id que no existe, o repetido: error (para añadir, la fila va sin id)", () => {
    const r = planDelAlmacen(FILAS, JSON.stringify([{ id: "zz", plato: "x" }]), MENU, "menu");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("«zz»");
    const d = planDelAlmacen(FILAS, JSON.stringify([{ id: "a1", plato: "x" }, { id: "a1", plato: "y" }]), MENU, "menu");
    expect(d.ok).toBe(false);
  });

  it("🔴 un campo NO declarado es un error, no se tira en silencio (el fichero mentiría)", () => {
    const r = planDelAlmacen(FILAS, JSON.stringify([{ plato: "x", picante: true }]), MENU, "menu");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("«picante»");
      expect(r.error).toContain("plato, precio");
    }
  });

  it("un valor del tipo equivocado es un error, con el campo nombrado", () => {
    const r = planDelAlmacen(FILAS, JSON.stringify([{ plato: "x", precio: "caro" }]), MENU, "menu");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("«precio»");
  });
});
