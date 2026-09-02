import { describe, expect, it } from "vitest";

import {
  hashDeContenido,
  planificarRepublicacion,
  seleccionar,
} from "./republicar-desde-disco";

const LIMPIA = `<!doctype html><html><body><form><button type="submit">Enviar</button></form></body></html>`;
// La misma plantilla ANTES de la limpieza del 01/09: con su `onsubmit`.
const SUCIA = `<!doctype html><html><body><form onsubmit="return false"><button type="submit">Enviar</button></form></body></html>`;

describe("qué hay que republicar", () => {
  // EL CASO REAL: el disco tiene la versión limpia, la galería sirve la sucia.
  it("caza la plantilla cuyo disco ya no coincide con la galería", () => {
    const plan = planificarRepublicacion(
      [{ id: "cumbre", html: LIMPIA }],
      [{ id: "cumbre", contentHash: hashDeContenido(SUCIA) }],
    );
    expect(plan.cambiadas).toHaveLength(1);
    expect(plan.cambiadas[0].id).toBe("cumbre");
    expect(plan.cambiadas[0].hashDisco).toBe(hashDeContenido(LIMPIA));
    expect(plan.iguales).toEqual([]);
  });

  // Las otras ~159 son copias fieles de lo que ya está en R2. Republicarlas
  // sería un no-op caro: nuevo objeto en el bucket a cambio de nada.
  it("no toca las que coinciden byte a byte", () => {
    const plan = planificarRepublicacion(
      [{ id: "mirror", html: LIMPIA }],
      [{ id: "mirror", contentHash: hashDeContenido(LIMPIA) }],
    );
    expect(plan.cambiadas).toEqual([]);
    expect(plan.iguales).toEqual(["mirror"]);
  });

  // Un `.html` suelto sin fila NO se da de alta: un alta necesita nombre,
  // familia, acento y descripción que el fichero no trae. Se enseña, no se actúa.
  it("un html sin fila en la galería se lista, no se da de alta", () => {
    const plan = planificarRepublicacion([{ id: "borrador", html: LIMPIA }], []);
    expect(plan.soloEnDisco).toEqual(["borrador"]);
    expect(plan.cambiadas).toEqual([]);
  });

  it("una fila sin fichero en el disco se lista aparte", () => {
    const plan = planificarRepublicacion([], [{ id: "antigua", contentHash: "abc" }]);
    expect(plan.soloEnGaleria).toEqual(["antigua"]);
  });

  it("el plan sale ordenado, para que dos corridas se puedan comparar a ojo", () => {
    const plan = planificarRepublicacion(
      [
        { id: "vispera", html: LIMPIA },
        { id: "albor", html: LIMPIA },
        { id: "eco", html: LIMPIA },
      ],
      [
        { id: "vispera", contentHash: "x" },
        { id: "albor", contentHash: "y" },
        { id: "eco", contentHash: "z" },
      ],
    );
    expect(plan.cambiadas.map((c) => c.id)).toEqual(["albor", "eco", "vispera"]);
  });
});

describe("qué se republica de verdad", () => {
  const plan = planificarRepublicacion(
    [
      { id: "cumbre", html: LIMPIA },
      { id: "mirror", html: LIMPIA },
    ],
    [
      { id: "cumbre", contentHash: hashDeContenido(SUCIA) },
      { id: "mirror", contentHash: hashDeContenido(LIMPIA) },
    ],
  );

  it("sin ids, van todas las cambiadas", () => {
    expect(seleccionar(plan).republicar.map((r) => r.id)).toEqual(["cumbre"]);
  });

  it("con ids, sólo esos", () => {
    expect(seleccionar(plan, ["cumbre"]).republicar.map((r) => r.id)).toEqual(["cumbre"]);
  });

  // Reescribir una fila que ya está bien deja un objeto huérfano en R2 a cambio
  // de nada. Se dice que se ignoró, no se hace en silencio.
  it("pedir una que NO cambió no la republica: la devuelve como ignorada", () => {
    const s = seleccionar(plan, ["mirror"]);
    expect(s.republicar).toEqual([]);
    expect(s.ignorados).toEqual(["mirror"]);
  });

  it("un id que no existe se denuncia en vez de fallar callando", () => {
    const s = seleccionar(plan, ["no-existe"]);
    expect(s.desconocidos).toEqual(["no-existe"]);
    expect(s.republicar).toEqual([]);
  });
});

describe("el hash", () => {
  // Si el `sha256` de store.ts cambia, esta prueba NO lo detecta y este módulo
  // empieza a mentir. Se ancla el valor para que al menos un cambio AQUÍ salte.
  it("es sha256 hex del utf8, igual que store.ts", () => {
    expect(hashDeContenido("hola")).toBe(
      "b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79",
    );
  });
});
