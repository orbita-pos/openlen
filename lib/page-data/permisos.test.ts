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

describe("modo publico", () => {
  // Lo que lo distingue de `añadir`, y la razón de que sea un modo aparte: aquí
  // el visitante SÍ ve lo que escribieron otros. Es el caso de unas reseñas —
  // dejas la tuya y la ves publicada al momento, como en Mercado Libre.
  it("cualquiera crea y TODOS leen", () => {
    expect(permite("publico", visitante, "crear")).toBe("propios");
    expect(permite("publico", visitante, "leer")).toBe("todos");
  });

  // 🔴 BRAZO DE CONTROL, y es la mitad que protege: público es escribir y leer,
  // NO editar lo ajeno. Sin esto cualquiera reescribiría o borraría la reseña
  // de otro, que es peor que no tener reseñas.
  it("pero NADIE modifica ni borra lo de otro", () => {
    expect(permite("publico", visitante, "modificar")).toBe("ninguno");
    expect(permite("publico", visitante, "borrar")).toBe("ninguno");
  });

  // Y `añadir` NO se contagia: sigue siendo el modo privado. Las dos filas
  // juntas son la comprobación que de verdad importa — se parecen en el código
  // y son opuestas en la intención.
  it("y `añadir` sigue sin dejar leer", () => {
    expect(permite("añadir", visitante, "leer")).toBe("ninguno");
    expect(permite("publico", visitante, "leer")).toBe("todos");
  });

  it("el dueño sigue alcanzándolo todo", () => {
    expect(permite("publico", { tipo: "dueño" }, "borrar")).toBe("todos");
  });
});
