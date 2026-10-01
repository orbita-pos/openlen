import { describe, expect, it } from "vitest";
import { enlaceDeCorreo, enlaceDeWhatsApp, numeroDeWhatsApp } from "./enlaces-de-respuesta";

describe("enlaceDeCorreo", () => {
  it("lleva asunto y texto codificados", () => {
    expect(enlaceDeCorreo("maria@ejemplo.com", "Tu pedido", "Sí, abrimos el domingo & festivos")).toBe(
      "mailto:maria@ejemplo.com?subject=Tu%20pedido&body=S%C3%AD%2C%20abrimos%20el%20domingo%20%26%20festivos",
    );
  });
  it("un correo mal formado no da enlace", () => {
    expect(enlaceDeCorreo("maria@", "x", "y")).toBeNull();
  });
});

describe("numeroDeWhatsApp", () => {
  it("con lada: sólo los dígitos", () => {
    expect(numeroDeWhatsApp("+52 33 1234 5678")).toBe("523312345678");
    expect(numeroDeWhatsApp("0052 33 1234 5678")).toBe("523312345678");
  });
  it("sin lada NO se inventa el país (lección de telefono-nuevo-sin-lada)", () => {
    expect(numeroDeWhatsApp("33 1234 5678")).toBeNull();
  });
});

describe("enlaceDeWhatsApp", () => {
  it("wa.me con el texto puesto", () => {
    expect(enlaceDeWhatsApp("523312345678", "Hola, sí")).toBe("https://wa.me/523312345678?text=Hola%2C%20s%C3%AD");
  });
});
