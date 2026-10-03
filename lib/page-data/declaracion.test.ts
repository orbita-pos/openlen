import { describe, expect, it } from "vitest";
import { leerDeclaracion, validaDocumento } from "./declaracion";

const bloque = (json: string) =>
  `<html><head><script type="application/json" data-ol-stores>${json}</script></head><body></body></html>`;

describe("leerDeclaracion", () => {
  it("lee un almacén completo", () => {
    const d = leerDeclaracion(
      bloque('{"carrito":{"visitante":"propio","caduca":"30d","campos":{"total":"numero"}}}'),
    );
    expect(d.carrito).toEqual({
      modo: "propio",
      caducaDias: 30,
      campos: { total: "numero" },
    });
  });

  it("sin bloque devuelve vacío, no lanza", () => {
    expect(leerDeclaracion("<html><body>hola</body></html>")).toEqual({});
  });

  it("JSON roto devuelve vacío, no lanza", () => {
    expect(leerDeclaracion(bloque("{no es json"))).toEqual({});
  });

  // Un modo inventado NO se degrada al más permisivo: se descarta el almacén.
  // Degradar sería convertir una errata del modelo en una puerta abierta.
  it("descarta un almacén con modo desconocido", () => {
    expect(leerDeclaracion(bloque('{"x":{"visitante":"todos","campos":{}}}'))).toEqual({});
  });

  it("descarta un campo con tipo desconocido y conserva el resto", () => {
    const d = leerDeclaracion(
      bloque('{"x":{"visitante":"lectura","campos":{"a":"texto","b":"geo"}}}'),
    );
    expect(d.x.campos).toEqual({ a: "texto" });
  });

  it("por defecto 90 días donde escribe el visitante, ninguno en lectura", () => {
    const d = leerDeclaracion(
      bloque('{"a":{"visitante":"propio","campos":{}},"b":{"visitante":"lectura","campos":{}}}'),
    );
    expect(d.a.caducaDias).toBe(90);
    expect(d.b.caducaDias).toBeNull();
  });

  it("recorta la caducidad al tope de 730 días", () => {
    const d = leerDeclaracion(bloque('{"a":{"visitante":"propio","caduca":"9999d","campos":{}}}'));
    expect(d.a.caducaDias).toBe(730);
  });
});

// Las cuentas de la página (plans/page-accounts/design.md): el modo `privado` y
// lo que cada almacén le da a cada papel.
describe("leerDeclaracion — privado y papeles", () => {
  it("lee un almacén privado con papeles, en la forma corta y en la larga", () => {
    const d = leerDeclaracion(
      bloque(
        '{"ventas":{"visitante":"privado","papeles":{"cajero":{"leer":"propios","crear":"propios"},"gerente":["leer","borrar"]},"campos":{"total":"numero"}}}',
      ),
    );
    expect(d.ventas).toEqual({
      modo: "privado",
      caducaDias: null,
      campos: { total: "numero" },
      papeles: {
        cajero: { leer: "propios", crear: "propios" },
        gerente: { leer: "todos", borrar: "todos" },
      },
    });
  });

  it("acepta papeles con acentos y ñ", () => {
    const d = leerDeclaracion(bloque('{"x":{"visitante":"lectura","papeles":{"dueña-de-turno":["leer"]}}}'));
    expect(d.x.papeles).toEqual({ "dueña-de-turno": { leer: "todos" } });
  });

  it("sin `papeles` el almacén queda como antes, sin el campo", () => {
    const d = leerDeclaracion(bloque('{"x":{"visitante":"lectura","campos":{}}}'));
    expect(d.x).not.toHaveProperty("papeles");
  });

  // 🔴 La regla del fichero: una errata del modelo NO abre una puerta. Una
  // acción, un alcance o un papel que no reconocemos descartan el almacén
  // entero — no se queda con «lo que sí se entendió».
  it.each([
    ['{"cajero":["leer","todo"]}', "una acción inventada"],
    ['{"cajero":{"leer":"algunos"}}', "un alcance inventado"],
    ['{"Cajero":["leer"]}', "un papel con mayúscula"],
    ['{"caj ero":["leer"]}', "un papel con espacio"],
    ['["cajero"]', "papeles como lista"],
    ['{"cajero":"leer"}', "un papel con una cadena"],
  ])("descarta el almacén con %s (%s)", (papeles) => {
    const d = leerDeclaracion(bloque(`{"x":{"visitante":"privado","papeles":${papeles}}}`));
    expect(d).toEqual({});
  });
});

describe("validaDocumento", () => {
  const almacen = {
    modo: "propio" as const,
    caducaDias: 90,
    campos: { nombre: "texto" as const, total: "numero" as const },
  };

  it("acepta un documento con los tipos correctos", () => {
    const r = validaDocumento(almacen, { nombre: "Ana", total: 12 });
    expect(r.ok).toBe(true);
  });

  it("rechaza un tipo que no cuadra", () => {
    const r = validaDocumento(almacen, { nombre: "Ana", total: "doce" });
    expect(r).toEqual({ ok: false, razon: "campo_invalido:total" });
  });

  // Descartar, no rechazar: un campo de más es una errata del modelo, y tirar
  // la escritura entera del visitante por eso le rompe la página a un tercero.
  it("descarta un campo no declarado y acepta el resto", () => {
    const r = validaDocumento(almacen, { nombre: "Ana", total: 1, colado: "x" });
    expect(r).toEqual({ ok: true, doc: { nombre: "Ana", total: 1 } });
  });

  it("acepta que falte un campo declarado", () => {
    const r = validaDocumento(almacen, { nombre: "Ana" });
    expect(r).toEqual({ ok: true, doc: { nombre: "Ana" } });
  });
});

// ⚰️ Aquí se probaba `DONDE_SE_DECLARA_UN_ALMACEN`, la frase de editar_html sobre
// data-op-id. Se retiró el 2026-09-25 con su último lector; lo que enseñaba
// —el bloque va en el <body> y fuera de cualquier sección que se pueda borrar—
// lo vigila ahora la prueba de ALMACENES de lib/agent/catalog.test.ts.
