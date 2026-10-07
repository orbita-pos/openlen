import { describe, expect, it, vi } from "vitest";

import { createPedidosALen } from "./pedidos-a-len";

describe("los pedidos a Len desde un hilo", () => {
  it("esperan en cola por proyecto, en orden, hasta que el chat los atiende", () => {
    const p = createPedidosALen();
    const oyente = vi.fn();
    p.subscribe(oyente);
    const a = { texto: "uno", hiloId: "h1" };
    const b = { texto: "dos", hiloId: "h2" };
    p.pedir("p1", a);
    p.pedir("p1", b);
    p.pedir("p2", { texto: "otro", hiloId: "h3" });
    expect(p.primero("p1")).toBe(a);
    p.atendido("p1", a);
    expect(p.primero("p1")).toBe(b);
    p.atendido("p1", b);
    expect(p.primero("p1")).toBeNull();
    expect(p.primero("p2")?.hiloId).toBe("h3");
    expect(oyente).toHaveBeenCalledTimes(5);
    // Atender dos veces lo mismo no avisa otra vez.
    p.atendido("p1", b);
    expect(oyente).toHaveBeenCalledTimes(5);
  });
});
