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

// ─── Cuentas de la página (plans/page-accounts/design.md) ───────────────────
// Una CUENTA es alguien que entró con correo y contraseña en una página que
// declara `data-ol-accounts`. Lo que alcanza es lo de un visitante MÁS lo que
// el almacén le da a su papel, y nunca menos: entrar no quita nada.

const cajero: Actor = { tipo: "cuenta", id: "a1", papel: "cajero" };
const sinPapel: Actor = { tipo: "cuenta", id: "a2", papel: null };

describe("modo privado", () => {
  // La propiedad que DEFINE el modo: el visitante anónimo no alcanza nada, ni
  // leer. Son las ventas de una caja: si esto se rompe, cualquiera que sepa la
  // URL ve lo que vendió el negocio.
  it("el visitante no alcanza NADA", () => {
    for (const accion of ["leer", "crear", "modificar", "borrar"] as const) {
      expect(permite("privado", visitante, accion)).toBe("ninguno");
    }
  });

  it("el dueño sigue alcanzándolo todo", () => {
    expect(permite("privado", dueño, "leer")).toBe("todos");
    expect(permite("privado", dueño, "borrar")).toBe("todos");
  });

  it("una cuenta alcanza lo que el almacén le da a su papel", () => {
    const papeles = { cajero: { leer: "propios", crear: "propios" } } as const;
    expect(permite("privado", cajero, "leer", papeles)).toBe("propios");
    expect(permite("privado", cajero, "crear", papeles)).toBe("propios");
    expect(permite("privado", cajero, "borrar", papeles)).toBe("ninguno");
  });

  // 🔴 BRAZO DE CONTROL: una cuenta cuyo papel el almacén no nombra es un
  // visitante más. Sin esto, entrar con CUALQUIER cuenta abriría las ventas.
  it("una cuenta sin papel, o con uno que el almacén no nombra, no alcanza nada", () => {
    const papeles = { cajero: { leer: "todos" } } as const;
    expect(permite("privado", sinPapel, "leer", papeles)).toBe("ninguno");
    expect(permite("privado", { tipo: "cuenta", id: "a3", papel: "socio" }, "leer", papeles)).toBe("ninguno");
  });
});

describe("una cuenta en los demás modos", () => {
  it("alcanza al menos lo de un visitante", () => {
    expect(permite("lectura", sinPapel, "leer")).toBe("todos");
    expect(permite("propio", sinPapel, "crear")).toBe("propios");
    expect(permite("publico", sinPapel, "leer")).toBe("todos");
    expect(permite("añadir", sinPapel, "leer")).toBe("ninguno");
  });

  it("y su papel lo amplía, nunca lo recorta", () => {
    // Un menú que el cajero puede corregir.
    expect(permite("lectura", cajero, "modificar", { cajero: { modificar: "todos" } })).toBe("todos");
    // Un papel que sólo declara `crear` no le quita la lectura del menú.
    expect(permite("lectura", cajero, "leer", { cajero: { crear: "todos" } })).toBe("todos");
    // De dos alcances, el más amplio.
    expect(permite("propio", cajero, "leer", { cajero: { leer: "todos" } })).toBe("todos");
  });

  // 🔴 BRAZO DE CONTROL: el papel de una cuenta no se le contagia al
  // visitante anónimo del mismo almacén.
  it("el visitante no hereda los papeles", () => {
    const papeles = { cajero: { leer: "todos", borrar: "todos" } } as const;
    expect(permite("añadir", visitante, "leer", papeles)).toBe("ninguno");
    expect(permite("publico", visitante, "borrar", papeles)).toBe("ninguno");
  });
});
