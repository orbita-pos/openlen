import { describe, expect, it } from "vitest";
import { MODELO_DE_VOZ, vozParaIdioma } from "./voces";

describe("vozParaIdioma", () => {
  it("español: marin, instrucciones en español que obligan a delegar y prohíben inventar causas", () => {
    const c = vozParaIdioma("es");
    expect(c.voz).toBe("marin");
    expect(c.instrucciones).toMatch(/Delega SIEMPRE/);
    expect(c.instrucciones).toMatch(/POR QUÉ/);
    expect(c.instrucciones).toMatch(/nunca adivines un número, un nombre ni una causa/);
    expect(c.instrucciones).toMatch(/Nunca digas que algo se envió o se publicó/);
    expect(c.saludo).toMatch(/Hola, soy Len/);
  });

  it("inglés: instrucciones en inglés; la voz se puede elegir para comparar", () => {
    expect(vozParaIdioma("en").voz).toBe("marin");
    expect(vozParaIdioma("en", { vozIngles: "gleam" }).voz).toBe("gleam");
    expect(vozParaIdioma("en").instrucciones).toMatch(/ALWAYS delegate/);
  });

  it("portugués: la voz de Brasil", () => {
    expect(vozParaIdioma("pt").voz).toBe("bossa");
  });

  it("el resto: marin, instrucciones en inglés y la orden de hablar su idioma", () => {
    const c = vozParaIdioma("fr");
    expect(c.voz).toBe("marin");
    expect(c.instrucciones).toMatch(/Speak only French/);
    expect(c.saludo).toMatch(/in French/);
  });

  it("un idioma desconocido cae a español, que es el de la casa", () => {
    expect(vozParaIdioma("xx").voz).toBe("marin");
    expect(vozParaIdioma("xx").instrucciones).toMatch(/Delega SIEMPRE/);
  });

  it("el modelo está en un solo sitio", () => {
    expect(MODELO_DE_VOZ).toMatch(/\S/);
  });
});
