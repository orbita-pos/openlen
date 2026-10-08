import { describe, expect, it, vi } from "vitest";

import { createTurnosDelHilo } from "./turnos-del-hilo";

const origen = { hiloId: "h1", ruta: "/src/App.jsx", linea: 3 };

describe("los turnos que Len empezó desde un hilo", () => {
  it("se anuncian por proyecto, en orden, hasta que el chat los recoge", () => {
    const p = createTurnosDelHilo();
    const oyente = vi.fn();
    p.subscribe(oyente);
    const a = { filaId: "f1", texto: "uno", origen };
    const b = { filaId: "f2", texto: "dos", origen };
    p.anunciar("p1", a);
    p.anunciar("p1", b);
    p.anunciar("p2", { filaId: "f3", texto: "otro", origen });
    expect(p.primero("p1")).toBe(a);
    p.recogido("p1", a);
    expect(p.primero("p1")).toBe(b);
    p.recogido("p1", b);
    expect(p.primero("p1")).toBeNull();
    expect(p.primero("p2")?.filaId).toBe("f3");
    expect(oyente).toHaveBeenCalledTimes(5);
    // Recoger dos veces lo mismo no avisa otra vez.
    p.recogido("p1", b);
    expect(oyente).toHaveBeenCalledTimes(5);
  });
});
