import { describe, expect, it } from "vitest";
import { permite, type Actor } from "./permisos";

const dueño: Actor = { tipo: "dueño" };
const visitante: Actor = { tipo: "visitante", id: "v1" };

describe("el dueño", () => {
  it("puede todo en los tres modos", () => {
    for (const modo of ["propio", "lectura", "añadir"] as const) {
      for (const accion of ["leer", "crear", "modificar", "borrar"] as const) {
        expect(permite(modo, dueño, accion)).toBe("todos");
      }
    }
  });
});

describe("modo propio", () => {
  it("el visitante sólo alcanza lo suyo", () => {
    expect(permite("propio", visitante, "leer")).toBe("propios");
    expect(permite("propio", visitante, "modificar")).toBe("propios");
    expect(permite("propio", visitante, "borrar")).toBe("propios");
  });

  it("y puede crear el suyo", () => {
    expect(permite("propio", visitante, "crear")).toBe("propios");
  });
});

describe("modo lectura", () => {
  it("el visitante lee todo", () => {
    expect(permite("lectura", visitante, "leer")).toBe("todos");
  });

  it("y no escribe nada", () => {
    expect(permite("lectura", visitante, "crear")).toBe("ninguno");
    expect(permite("lectura", visitante, "modificar")).toBe("ninguno");
    expect(permite("lectura", visitante, "borrar")).toBe("ninguno");
  });
});

describe("modo añadir", () => {
  // La propiedad que DEFINE el modo: crear sí, leer NO. Si esto se rompe, las
  // reseñas de una página se convierten en la lista de correos de otra.
  it("el visitante crea pero NO lee", () => {
    expect(permite("añadir", visitante, "crear")).toBe("propios");
    expect(permite("añadir", visitante, "leer")).toBe("ninguno");
  });

  it("y no modifica ni borra", () => {
    expect(permite("añadir", visitante, "modificar")).toBe("ninguno");
    expect(permite("añadir", visitante, "borrar")).toBe("ninguno");
  });
});
