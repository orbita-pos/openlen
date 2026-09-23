import { describe, expect, it } from "vitest";
import { prefijosInventados } from "./prefijo-inventado";

const ANTES = `<footer><a href="tel:+34600112233">600112233</a></footer>`;
const PIDE = "cambie de telefono: pon 33 1234 5678 en el pie";

describe("el prefijo de país que nadie dio", () => {
  it("🔴 C21 · tel:+333312345678 lleva un +33 que no sale de ningún sitio", () => {
    const despues = `<footer><a href="tel:+333312345678">33 1234 5678</a></footer>`;
    expect(prefijosInventados({ antes: ANTES, despues, fuentes: [PIDE] })).toEqual([
      { href: "tel:+333312345678", dictado: "3312345678", prefijo: "33" },
    ]);
  });

  it("un wa.me con un país inventado, también", () => {
    const despues = `<a href="https://wa.me/523312345678">WhatsApp</a>`;
    expect(prefijosInventados({ antes: "", despues, fuentes: [PIDE] })[0]?.prefijo).toBe("52");
  });

  it("BRAZO DE CONTROL: las cifras tal cual se dictaron no avisan", () => {
    const despues = `<footer><a href="tel:3312345678">33 1234 5678</a></footer>`;
    expect(prefijosInventados({ antes: ANTES, despues, fuentes: [PIDE] })).toEqual([]);
  });

  it("…ni el prefijo que el dueño SÍ dio", () => {
    const despues = `<a href="https://wa.me/523312345678">WhatsApp</a>`;
    expect(prefijosInventados({ antes: "", despues, fuentes: ["mi whatsapp es +52 33 1234 5678"] })).toEqual([]);
  });

  it("…ni el país que la página ya usaba", () => {
    const despues = `<footer><a href="tel:+343312345678">33 1234 5678</a></footer>`;
    expect(prefijosInventados({ antes: ANTES, despues, fuentes: [PIDE] })).toEqual([]);
  });

  it("…ni un enlace que ya estaba en la página", () => {
    const conEl = `<a href="tel:+333312345678">x</a>`;
    expect(prefijosInventados({ antes: conEl, despues: conEl, fuentes: [PIDE] })).toEqual([]);
  });
});
