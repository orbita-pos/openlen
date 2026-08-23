import { describe, expect, it } from "vitest";

import { avisoHechosPerdidos, hechosPerdidos } from "./facts-kept";

const FOTO = "https://images.openlen.com/taller-fachada.webp";
const WA = "https://wa.me/525512345678";

const ANTES = `<!doctype html><html><body>
  <h1>Taller El Norte</h1>
  <img src="${FOTO}" alt="Fachada">
  <a href="${WA}">Agendar</a>
  <a href="#servicios">Servicios</a>
  <p>Calle Colima 12 · Tel. 55 1234 5678</p>
</body></html>`;

describe("los hechos del dueño tras una reescritura", () => {
  it("un rediseño que conserva todo no reporta nada", () => {
    const despues = `<!doctype html><html><body>
      <header><h1>El Norte</h1></header>
      <figure><img src="${FOTO}" alt="Nuestro taller"></figure>
      <a class="cta" href="${WA}">Escríbenos</a>
      <footer>Colima 12 — (55) 1234-5678</footer>
    </body></html>`;
    expect(hechosPerdidos(ANTES, despues)).toEqual([]);
  });

  // EL FALLO MEDIDO: 8 de 20 rediseños perdieron la URL de la foto real. No es
  // decoración — es una foto que el dueño subió y que el modelo no puede
  // re-inventar.
  it("nombra la foto que desapareció", () => {
    const despues = `<html><body><h1>El Norte</h1><a href="${WA}">x</a><p>55 1234 5678</p></body></html>`;
    const p = hechosPerdidos(ANTES, despues);
    expect(p).toContainEqual({ tipo: "imagen", valor: FOTO });
  });

  it("nombra el enlace externo que desapareció", () => {
    const despues = `<html><body><img src="${FOTO}"><p>55 1234 5678</p></body></html>`;
    expect(hechosPerdidos(ANTES, despues)).toContainEqual({ tipo: "enlace", valor: WA });
  });

  // Reformatear un teléfono NO es perderlo, y castigarlo convertiría cualquier
  // rediseño en un aviso falso.
  it("un teléfono reformateado NO cuenta como perdido", () => {
    const despues = `<html><body><img src="${FOTO}"><a href="${WA}">x</a><p>(55) 1234-5678</p></body></html>`;
    expect(hechosPerdidos(ANTES, despues)).toEqual([]);
  });

  it("pero un teléfono que se fue del todo sí", () => {
    const despues = `<html><body><img src="${FOTO}"><a href="${WA}">x</a><p>Estamos en la Roma</p></body></html>`;
    expect(hechosPerdidos(ANTES, despues)).toContainEqual({ tipo: "telefono", valor: "5512345678" });
  });

  // Un ancla interna se reorganiza legítimamente en un rediseño: la lista es
  // corta a propósito, porque una regla que dispara de más acaba apagada.
  it("un ancla interna que desaparece no es un hecho perdido", () => {
    const despues = `<html><body><img src="${FOTO}"><a href="${WA}">x</a><p>55 1234 5678</p></body></html>`;
    expect(hechosPerdidos(ANTES, despues).some((p) => p.valor.includes("#"))).toBe(false);
  });

  it("una foto de fondo puesta por CSS cuenta igual", () => {
    const antes = `<html><body><div style="background-image:url('${FOTO}')"></div></body></html>`;
    expect(hechosPerdidos(antes, `<html><body><div></div></body></html>`)).toContainEqual({
      tipo: "imagen",
      valor: FOTO,
    });
  });

  it("un data: URI no es un hecho — no hay nada que volver a buscar", () => {
    const antes = `<html><body><img src="data:image/png;base64,iVBORw0KGgo="></body></html>`;
    expect(hechosPerdidos(antes, `<html><body></body></html>`)).toEqual([]);
  });
});

describe("el aviso al modelo", () => {
  it("nombra el valor exacto y le dice que lo reponga YA", () => {
    const a = avisoHechosPerdidos([{ tipo: "imagen", valor: FOTO }]);
    expect(a).toContain(FOTO);
    expect(a).toMatch(/editar_pagina/);
    // Y que no cierre el turno diciendo que está listo: es el fallo del
    // «Listo ✅» sobre una página intacta, aplicado aquí.
    expect(a).toMatch(/NO le digas al usuario/);
  });

  it("se acota, pero dice cuántos más hay", () => {
    const muchos = Array.from({ length: 9 }, (_, i) => ({
      tipo: "imagen" as const,
      valor: `https://x.com/${i}.webp`,
    }));
    const a = avisoHechosPerdidos(muchos);
    expect(a).toContain("9 dato(s)");
    expect(a).toContain("y 3 más");
  });
});
