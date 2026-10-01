// @vitest-environment node
import { describe, expect, it } from "vitest";
import { estadoValido, huella, llaveDeLaCabecera, secretoNuevo } from "./secreto";

describe("los secretos de la app", () => {
  it("cada secreto es nuevo y de 43 caracteres base64url", () => {
    const a = secretoNuevo();
    const b = secretoNuevo();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("la huella es SHA-256 en hex, estable, y distinta del secreto", () => {
    expect(huella("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(huella("abc")).toBe(huella("abc"));
    expect(huella("abd")).not.toBe(huella("abc"));
  });

  it("el estado: 16 a 128 caracteres seguros para una URL", () => {
    expect(estadoValido("a".repeat(16))).toBe(true);
    expect(estadoValido("a".repeat(15))).toBe(false);
    expect(estadoValido("a".repeat(129))).toBe(false);
    expect(estadoValido("con espacio 0123456789")).toBe(false);
    expect(estadoValido(42)).toBe(false);
  });

  it("de la cabecera sólo sale una llave con la forma «Bearer <llave>»", () => {
    const llave = secretoNuevo();
    expect(llaveDeLaCabecera(`Bearer ${llave}`)).toBe(llave);
    expect(llaveDeLaCabecera(`bearer ${llave}`)).toBeNull();
    expect(llaveDeLaCabecera("Bearer corta")).toBeNull();
    expect(llaveDeLaCabecera("Basic dXNlcjpwYXNz")).toBeNull();
    expect(llaveDeLaCabecera(null)).toBeNull();
  });
});
