// lib/workspace-v2/cambios-en-vivo.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCambiosEnVivo, esFicheroCambiado } from "./cambios-en-vivo";

const UNO = { ruta: "/index.html", tipo: "texto" as const, antes: "a\n", despues: "b\n" };

describe("esFicheroCambiado — lo que llega por el evento `cambios`", () => {
  it("acepta las dos formas y descarta lo demás", () => {
    expect(esFicheroCambiado(UNO)).toBe(true);
    expect(esFicheroCambiado({ ruta: "/menu/index.html", tipo: "grande", nuevo: false, borrado: true })).toBe(true);
    expect(esFicheroCambiado({ ...UNO, antes: null })).toBe(true);
    expect(esFicheroCambiado({ ...UNO, antes: null, despues: null })).toBe(false);
    expect(esFicheroCambiado({ ...UNO, ruta: "index.html" })).toBe(false);
    expect(esFicheroCambiado({ ...UNO, despues: 3 })).toBe(false);
    expect(esFicheroCambiado({ ruta: "/x", tipo: "otro" })).toBe(false);
    expect(esFicheroCambiado(null)).toBe(false);
  });
});

describe("createCambiosEnVivo", () => {
  it("guarda por proyecto; el mismo turno se sustituye; la referencia no cambia si no cambia nada", () => {
    const c = createCambiosEnVivo();
    expect(c.turnos("p1")).toBe(c.turnos("p1"));
    c.guardar("p1", { turnId: "t1", pedido: "uno", ficheros: [UNO] });
    c.guardar("p1", { turnId: "t2", pedido: "dos", ficheros: [UNO] });
    c.guardar("p1", { turnId: "t1", pedido: "uno otra vez", ficheros: [UNO] });
    expect(c.turnos("p1").map((t) => t.pedido)).toEqual(["dos", "uno otra vez"]);
    expect(c.turnos("p2")).toEqual([]);
    const misma = c.turnos("p1");
    expect(c.turnos("p1")).toBe(misma);
  });

  it("guarda los 20 últimos turnos", () => {
    const c = createCambiosEnVivo();
    for (let i = 0; i < 25; i++) c.guardar("p1", { turnId: `t${i}`, pedido: "", ficheros: [UNO] });
    expect(c.turnos("p1")).toHaveLength(20);
    expect(c.turnos("p1")[0]!.turnId).toBe("t5");
  });

  it("abrir deja una petición nueva cada vez y avisa", () => {
    const c = createCambiosEnVivo();
    const aviso = vi.fn();
    c.subscribe(aviso);
    c.abrir("p1", "t1", "/index.html");
    const primera = c.peticion("p1");
    c.abrir("p1", "t1", "/index.html");
    expect(c.peticion("p1")).toEqual({ turnId: "t1", ruta: "/index.html", n: primera!.n + 1 });
    expect(aviso).toHaveBeenCalledTimes(2);
    expect(c.peticion("p2")).toBeNull();
  });
});
