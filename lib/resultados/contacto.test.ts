import { describe, expect, it } from "vitest";
import { contactoDe, lineaDe } from "./contacto";

describe("contactoDe", () => {
  it("saca nombre, correo y teléfono por la clave", () => {
    expect(contactoDe({ Nombre: "María López", Correo: "maria@ejemplo.com", "Teléfono": "+52 33 1234 5678" })).toEqual({
      nombre: "María López", correo: "maria@ejemplo.com", telefono: "+52 33 1234 5678",
    });
  });
  it("reconoce un correo por el valor aunque la clave no lo diga", () => {
    expect(contactoDe({ contacto: "pedro@ejemplo.com" }).correo).toBe("pedro@ejemplo.com");
  });
  it("un correo mal formado no es correo", () => {
    expect(contactoDe({ email: "no-es-correo" }).correo).toBeNull();
  });
  it("sin datos de contacto, todo null", () => {
    expect(contactoDe({ mensaje: "hola" })).toEqual({ nombre: null, correo: null, telefono: null });
  });
});

describe("lineaDe", () => {
  it("la primera respuesta que no es de contacto, recortada", () => {
    expect(lineaDe({ nombre: "María", mensaje: "¿Abren el domingo? Quiero un pastel de tres leches" }, 20)).toBe("¿Abren el domingo? Q…");
  });
});
