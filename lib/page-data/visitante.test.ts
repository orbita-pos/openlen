import { describe, expect, it } from "vitest";
import { nuevoVisitante, verificaVisitante } from "./visitante";

const SECRETO = "secreto-de-prueba-suficientemente-largo";

describe("la cookie del visitante", () => {
  it("ida y vuelta devuelve el mismo id", () => {
    const cookie = nuevoVisitante(SECRETO);
    const id = verificaVisitante(cookie, SECRETO);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("dos visitantes distintos no colisionan", () => {
    expect(nuevoVisitante(SECRETO)).not.toBe(nuevoVisitante(SECRETO));
  });

  // Sin esto, cualquiera se inventa el id de otro y le lee el carrito.
  it("rechaza una firma manipulada", () => {
    const cookie = nuevoVisitante(SECRETO);
    const [id] = cookie.split(".");
    expect(verificaVisitante(`${id}.firmafalsa`, SECRETO)).toBeNull();
  });

  it("rechaza un id manipulado con firma buena de otro", () => {
    const [, firma] = nuevoVisitante(SECRETO).split(".");
    expect(
      verificaVisitante(`00000000000000000000000000000000.${firma}`, SECRETO),
    ).toBeNull();
  });

  it("rechaza otra clave", () => {
    const cookie = nuevoVisitante(SECRETO);
    expect(verificaVisitante(cookie, "otra-clave-distinta-y-larga")).toBeNull();
  });

  it("sin cookie devuelve null, no lanza", () => {
    expect(verificaVisitante(undefined, SECRETO)).toBeNull();
    expect(verificaVisitante("", SECRETO)).toBeNull();
    expect(verificaVisitante("basura", SECRETO)).toBeNull();
  });
});
