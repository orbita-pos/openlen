import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  hashDeContenido,
  planificarRepublicacion,
  seleccionar,
} from "./republicar-desde-disco";

const LIMPIA = `<!doctype html><html><body><form><button type="submit">Enviar</button></form></body></html>`;
// La misma plantilla ANTES de la limpieza del 01/09: con su `onsubmit`.
const SUCIA = `<!doctype html><html><body><form onsubmit="return false"><button type="submit">Enviar</button></form></body></html>`;

/**
 * Réplica LITERAL de lo que `store.ts:176` escribe en `templates.contentHash`.
 *
 * NO llama a `hashDeContenido` A PROPÓSITO. Hasta el 02/09 todas las pruebas de
 * este fichero construían la fila de galería con esa función, así que los dos
 * lados de la comparación compartían la misma forma y el desajuste con
 * producción —64 hex aquí, 12 guardados allí— era invisible. Si las dos formas
 * vuelven a separarse, ESTA es la que tiene que romperse.
 */
function comoLoGuardaStore(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
}

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
  // Anclado A MANO, no derivado de la función: es la única forma de que un
  // cambio en la propia `hashDeContenido` salte. El valor son los 12 primeros
  // hex del sha256 de "hola" (b221d9dbb083a7f3…), que es exactamente lo que
  // store.ts:176 guarda en `templates.contentHash`.
  it("es el sha256 RECORTADO a 12, que es lo que la galería guarda", () => {
    expect(hashDeContenido("hola")).toBe("b221d9dbb083");
  });

  it("coincide con lo que store.ts escribiría para el mismo html", () => {
    expect(hashDeContenido(LIMPIA)).toBe(comoLoGuardaStore(LIMPIA));
    expect(hashDeContenido(SUCIA)).toBe(comoLoGuardaStore(SUCIA));
  });
});

/**
 * LA REGRESIÓN DEL 02/09. Estas dos prueban contra la forma que la galería
 * guarda de verdad, sin pasar por `hashDeContenido` para construir la fila.
 *
 * Antes del arreglo, la primera fallaba: `hashDeContenido` devolvía 64 hex y la
 * fila traía 12, así que NADA empataba nunca. En producción eso salió como
 * `iguales: 0` con 169 de 172 plantillas marcadas como cambiadas — 121 de ellas
 * idénticas byte a byte a lo que ya servía R2.
 */
describe("contra el hash tal y como lo guarda la galería", () => {
  it("una plantilla intacta sale IGUAL, no cambiada", () => {
    const plan = planificarRepublicacion(
      [{ id: "mirror", html: LIMPIA }],
      [{ id: "mirror", contentHash: comoLoGuardaStore(LIMPIA) }],
    );
    expect(plan.iguales).toEqual(["mirror"]);
    expect(plan.cambiadas).toEqual([]);
  });

  it("y una que de verdad cambió se sigue cazando", () => {
    const plan = planificarRepublicacion(
      [{ id: "cumbre", html: LIMPIA }],
      [{ id: "cumbre", contentHash: comoLoGuardaStore(SUCIA) }],
    );
    expect(plan.cambiadas.map((c) => c.id)).toEqual(["cumbre"]);
    expect(plan.iguales).toEqual([]);
  });

  // El caso que hizo el informe inservible: un lote donde casi todo está bien.
  it("un lote mayoritariamente intacto no se marca entero como cambiado", () => {
    const intactas = ["albor", "eco", "lazo", "sello", "umbral"];
    const plan = planificarRepublicacion(
      [...intactas.map((id) => ({ id, html: LIMPIA })), { id: "cumbre", html: LIMPIA }],
      [
        ...intactas.map((id) => ({ id, contentHash: comoLoGuardaStore(LIMPIA) })),
        { id: "cumbre", contentHash: comoLoGuardaStore(SUCIA) },
      ],
    );
    expect(plan.iguales).toEqual(intactas);
    expect(plan.cambiadas.map((c) => c.id)).toEqual(["cumbre"]);
  });
});
