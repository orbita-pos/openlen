import { describe, expect, it } from "vitest";

import { avisoEnlacesDesfasados, enlacesDesfasados } from "./enlaces-desfasados";

// DOS BRAZOS EN TODO. Que cace el enlace torcido (si no, es la guarda que no
// existía) y que CALLE en los que están bien (si no, es la guarda que llora al
// lobo, y una guarda que llora se acaba apagando).

describe("un enlace que dice un número y marca otro", () => {
  it("caza EL CASO REAL: el texto cambió y el href se quedó con el viejo", () => {
    // Escenario `copy`, corrida del 2026-09-03. `ops: text×2`, cero `attrs`.
    const html = '<a class="cta-tel" href="tel:+528188880000">81 1234 5678</a>';
    expect(enlacesDesfasados(html)).toEqual([
      { tipo: "tel", texto: "81 1234 5678", href: "tel:+528188880000" },
    ]);
  });

  it("BRAZO DE CONTROL: el prefijo de país NO es una discrepancia", () => {
    // `tel:+528112345678` y «81 1234 5678» son el MISMO número. Exigir igualdad
    // exacta convertiría en hallazgo la forma correcta de escribir un teléfono.
    expect(enlacesDesfasados('<a href="tel:+528112345678">81 1234 5678</a>')).toEqual([]);
    // Y al revés: el texto con prefijo y el href sin él.
    expect(enlacesDesfasados('<a href="tel:8112345678">+52 81 1234 5678</a>')).toEqual([]);
  });

  it("un enlace sin número en el texto no promete nada", () => {
    expect(enlacesDesfasados('<a href="tel:+528188880000">Llámanos</a>')).toEqual([]);
    expect(enlacesDesfasados('<a href="tel:+528188880000">Pide cita hoy</a>')).toEqual([]);
  });

  it("no confunde un horario ni un precio con un teléfono", () => {
    expect(enlacesDesfasados('<a href="tel:+528188880000">Abierto 9 a 19</a>')).toEqual([]);
    expect(enlacesDesfasados('<a href="tel:+528188880000">Desde $180</a>')).toEqual([]);
  });

  it("ve el número aunque venga envuelto en etiquetas", () => {
    const html = '<a href="tel:+528188880000"><span class="n">81 1234 5678</span></a>';
    expect(enlacesDesfasados(html)).toHaveLength(1);
  });

  it("el correo: caza el desfase y calla cuando coinciden", () => {
    expect(
      enlacesDesfasados('<a href="mailto:viejo@bernal.mx">hola@bernal.mx</a>'),
    ).toEqual([{ tipo: "correo", texto: "hola@bernal.mx", href: "mailto:viejo@bernal.mx" }]);
    expect(enlacesDesfasados('<a href="mailto:hola@bernal.mx">hola@bernal.mx</a>')).toEqual([]);
    // Mayúsculas no son un desfase, y un `?subject=` tampoco.
    expect(
      enlacesDesfasados('<a href="mailto:Hola@Bernal.mx?subject=Cita">hola@bernal.mx</a>'),
    ).toEqual([]);
    // Un botón que no dice ninguna dirección no puede contradecir al destino.
    expect(enlacesDesfasados('<a href="mailto:hola@bernal.mx">Escríbenos</a>')).toEqual([]);
  });

  it("una página entera y sana no dice nada", () => {
    const sana = `<!doctype html><html><body>
      <a class="cta-tel" href="tel:+528112345678">81 1234 5678</a>
      <a href="/servicios">Servicios</a>
      <a href="https://wa.me/528112345678">WhatsApp</a>
      <a href="mailto:hola@bernal.mx">hola@bernal.mx</a>
    </body></html>`;
    expect(enlacesDesfasados(sana)).toEqual([]);
  });

  it("el aviso nombra el enlace y DICE con qué verbo se arregla", () => {
    const a = avisoEnlacesDesfasados([
      { tipo: "tel", texto: "81 1234 5678", href: "tel:+528188880000" },
    ]);
    expect(a).toContain("81 1234 5678");
    expect(a).toContain("tel:+528188880000");
    // Lo que no es obvio y por eso se dice: son DOS ops sobre el mismo elemento.
    expect(a).toMatch(/op="text"/);
    expect(a).toMatch(/op="attrs"/);
  });
});
