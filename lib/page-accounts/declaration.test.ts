import { describe, expect, it } from "vitest";
import { readAccountsDeclaration } from "./declaration";

const bloque = (json: string) =>
  `<html><body><script type="application/json" data-ol-accounts>${json}</script></body></html>`;

describe("readAccountsDeclaration", () => {
  it("lee el registro y los papeles", () => {
    expect(readAccountsDeclaration(bloque('{"registro":"cerrado","papeles":["cajero","gerente"]}'))).toEqual({
      registro: "cerrado",
      papeles: ["cajero", "gerente"],
    });
  });

  // Sin bloque no hay cuentas: la página es la de siempre y una cookie de
  // sesión vieja no vale nada en ella.
  it("sin bloque, o con JSON roto, no hay cuentas", () => {
    expect(readAccountsDeclaration("<html><body>hola</body></html>")).toBeNull();
    expect(readAccountsDeclaration(bloque("{roto"))).toBeNull();
    expect(readAccountsDeclaration(bloque("[]"))).toBeNull();
  });

  // Ante la duda, MENOS permiso: un registro que no reconocemos es `cerrado`
  // —sólo el dueño crea cuentas—, nunca `abierto`.
  it("un registro ausente o inventado es cerrado", () => {
    expect(readAccountsDeclaration(bloque('{"papeles":["cajero"]}'))?.registro).toBe("cerrado");
    expect(readAccountsDeclaration(bloque('{"registro":"libre"}'))?.registro).toBe("cerrado");
  });

  it("lee abierto e invitacion", () => {
    expect(readAccountsDeclaration(bloque('{"registro":"abierto"}'))?.registro).toBe("abierto");
    expect(readAccountsDeclaration(bloque('{"registro":"invitacion"}'))?.registro).toBe("invitacion");
  });

  // Un papel mal escrito no da nada por sí solo —un papel sólo vale lo que le
  // dan los almacenes—, así que se descarta ESE papel y no la declaración.
  it("descarta los papeles mal escritos y los repetidos, conserva el resto", () => {
    const d = readAccountsDeclaration(bloque('{"papeles":["cajero","Gerente","",7,"cajero","dueña"]}'));
    expect(d?.papeles).toEqual(["cajero", "dueña"]);
  });

  it("como mucho 20 papeles", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => `p${i}`);
    expect(readAccountsDeclaration(bloque(JSON.stringify({ papeles: muchos })))?.papeles).toHaveLength(20);
  });
});
