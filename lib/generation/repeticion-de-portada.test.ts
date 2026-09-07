import { describe, expect, it } from "vitest";

import { MINIMO, repeticionDePortada } from "./repeticion-de-portada";

const largo = (n: number) => "una frase de contenido con sustancia numero " + n + " que pasa del umbral";
const doc = (dentro: string) => "<!doctype html><html><body>" + dentro + "</body></html>";
const seccion = (n: number) => "<section><h2>" + largo(n) + "</h2><p>" + largo(n + 100) + "</p></section>";

const PORTADA = doc(
  "<header><p>" + largo(900) + "</p></header>" +
  seccion(1) + seccion(2) + seccion(3) +
  "<footer><p>" + largo(901) + "</p></footer>",
);

describe("cuánto de una subpágina ya estaba en la portada", () => {
  it("una subpágina con contenido propio no repite nada", () => {
    const r = repeticionDePortada(PORTADA, doc(seccion(50) + seccion(51)));
    expect(r.repetidos).toBe(0);
    expect(r.rachaMaxima).toBe(0);
    expect(r.peor).toBeNull();
  });

  // 🔴 EL PROMPT LAS EXIGE IDÉNTICAS: "la misma cabecera y el mismo pie, con
  // los mismos enlaces". Contarlas acusaría al 100% de las subpáginas por
  // OBEDECER, que es como murió el veredicto `prueba`.
  it("la cabecera y el pie repetidos NO cuentan", () => {
    const r = repeticionDePortada(
      PORTADA,
      doc(
        "<header><p>" + largo(900) + "</p></header>" +
        seccion(50) +
        "<footer><p>" + largo(901) + "</p></footer>",
      ),
    );
    expect(r.repetidos).toBe(0);
  });

  it("y tampoco cuenta una nav repetida", () => {
    const r = repeticionDePortada(PORTADA, doc("<nav><p>" + largo(1) + "</p></nav>" + seccion(50)));
    expect(r.repetidos).toBe(0);
  });

  it("una frase corta no cuenta: se repite sola", () => {
    const corta = "<p>Urgencias 24h</p>";
    expect(corta.length).toBeLessThan(MINIMO);
    const r = repeticionDePortada(doc(corta), doc(corta + seccion(50)));
    expect(r.repetidos).toBe(0);
  });

  // Medido el 2026-09-07 sobre /servicios: repetía la dirección y el horario,
  // SUELTOS. Repetir un dato verdadero entre páginas es correcto.
  it("dos datos repetidos pero sueltos dan racha 1", () => {
    const sub = doc(seccion(50) + "<p>" + largo(1) + "</p>" + seccion(51) + "<p>" + largo(2) + "</p>");
    const r = repeticionDePortada(PORTADA, sub);
    expect(r.repetidos).toBe(2);
    expect(r.rachaMaxima).toBe(1);
  });

  // 🔴 LA SEÑAL. Una sección pegada deja los bloques SEGUIDOS. Sobre las
  // páginas reales esto dio racha 10 contra la racha 1 de los datos sueltos.
  it("una sección entera copiada deja racha larga", () => {
    const r = repeticionDePortada(PORTADA, doc(seccion(50) + seccion(1) + seccion(2)));
    expect(r.rachaMaxima).toBeGreaterThanOrEqual(4);
    expect(r.repetidos).toBe(4);
  });

  it("nombra el repetido más largo", () => {
    const r = repeticionDePortada(PORTADA, doc(seccion(1)));
    expect(r.peor).toContain("numero 1");
  });

  it("la portada contra sí misma se repite entera — si esto no dispara, no mide nada", () => {
    const r = repeticionDePortada(PORTADA, PORTADA);
    expect(r.repetidos).toBe(r.total);
    expect(r.total).toBeGreaterThan(0);
    expect(r.rachaMaxima).toBe(r.total);
  });
});
