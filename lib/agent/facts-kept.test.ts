import { describe, expect, it } from "vitest";

import {
  avisoHechosPerdidos,
  avisoHechosPerdidosEnEdicion,
  avisoMetaDesfasada,
  hechosPerdidos,
  hechosPerdidosNetos,
  metaDesfasada,
} from "./facts-kept";

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

// MEDIDO con los ataques de QA (2026-08-22): «cambia nuestro telefono en TODA
// la pagina» actualizaba texto, tel: y WhatsApp, y dejaba el viejo en la meta
// description — 3 de 3. Con el camino abierto paso a 1 de 3; con este detector,
// 4 de 4. Pedirlo no bastaba; hacerlo COMPROBABLE si.
describe("la meta description que se queda atras", () => {
  const pagina = (meta: string, cuerpo: string) =>
    `<html><head><meta name="description" content="${meta}"></head><body>${cuerpo}</body></html>`;

  it("caza el telefono viejo que sobrevive en la meta", () => {
    const r = metaDesfasada(pagina("Clínica Ríos · Tel. 614 555 0100", "<p>Tel. 614 555 0198</p>"));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("614 555 0100");
  });

  // Reformatear no es quedarse atras: se comparan DIGITOS.
  it("un telefono reformateado NO es un desfase", () => {
    expect(metaDesfasada(pagina("Tel. 614 555 0198", "<p>(614) 555-0198</p>"))).toEqual([]);
  });

  it("caza tambien un correo que ya no esta", () => {
    const r = metaDesfasada(pagina("Escríbenos a viejo@clinica.com", "<p>citas@clinica.com</p>"));
    expect(r).toEqual(["viejo@clinica.com"]);
  });

  // Del resto del texto no se puede decir lo mismo: reescribir un eslogan no
  // deja la meta «mal», la deja distinta.
  it("un eslogan reescrito no dispara nada", () => {
    expect(metaDesfasada(pagina("La mejor clínica de la ciudad", "<p>Odontología integral</p>"))).toEqual([]);
  });

  it("sin meta description no hay nada que comprobar", () => {
    expect(metaDesfasada(`<html><head></head><body><p>Tel. 614 555 0100</p></body></html>`)).toEqual([]);
  });

  it("el aviso dice el dato y por que importa", () => {
    const a = avisoMetaDesfasada(["614 555 0100"]);
    expect(a).toContain("614 555 0100");
    expect(a).toMatch(/Google/);
    expect(a).toMatch(/target="head"/);
  });
});

// ───── LA VARIANTE DE LA EDICIÓN ─────
//
// DOS BRAZOS, SIEMPRE. Que hable cuando se quita (si no, es la guarda que no
// existe, que es lo que había) y que CALLE cuando se sustituye (si no, es la
// guarda que llora al lobo, y una guarda que llora se acaba apagando).
describe("una edición que se lleva un dato del dueño", () => {
  const OTRA_FOTO = "https://images.openlen.com/taller-nuevo.webp";

  it("QUITAR la foto suena — el fallo de la portada de Aurora", () => {
    const despues = ANTES.replace(
      `<img src="${FOTO}" alt="Fachada">`,
      '<div style="background:#0b1220;height:420px"></div>',
    );
    expect(hechosPerdidosNetos(ANTES, despues)).toEqual([{ tipo: "imagen", valor: FOTO }]);
  });

  it("BRAZO DE CONTROL: sustituir la foto NO suena — la cuenta no baja", () => {
    const despues = ANTES.replace(FOTO, OTRA_FOTO);
    // `hechosPerdidos`, el de siempre, SÍ la reportaría: la URL vieja no está.
    expect(hechosPerdidos(ANTES, despues)).toEqual([{ tipo: "imagen", valor: FOTO }]);
    // La variante de la edición calla, que es lo correcto: se lo pidieron.
    expect(hechosPerdidosNetos(ANTES, despues)).toEqual([]);
  });

  it("una edición que no toca los hechos no dice nada", () => {
    const despues = ANTES.replace("Taller El Norte", "Taller El Norte — Monterrey");
    expect(hechosPerdidosNetos(ANTES, despues)).toEqual([]);
  });

  it("cambiar el WhatsApp calla; quitarlo suena", () => {
    const cambiado = ANTES.replace(WA, "https://wa.me/528181110000");
    expect(hechosPerdidosNetos(ANTES, cambiado)).toEqual([]);

    const quitado = ANTES.replace(`<a href="${WA}">Agendar</a>`, "<span>Agendar</span>");
    expect(hechosPerdidosNetos(ANTES, quitado)).toEqual([{ tipo: "enlace", valor: WA }]);
  });

  it("sustituir una foto Y quitar otra nombra las dos, y la cuenta baja una", () => {
    const dos = ANTES.replace(
      `<img src="${FOTO}" alt="Fachada">`,
      `<img src="${FOTO}" alt="Fachada"><img src="${OTRA_FOTO}" alt="Taller">`,
    );
    const TERCERA = "https://images.openlen.com/taller-tercera.webp";
    const despues = dos.replace(FOTO, TERCERA).replace(`<img src="${OTRA_FOTO}" alt="Taller">`, "");
    const perdidos = hechosPerdidosNetos(dos, despues).map((h) => h.valor).sort();
    expect(perdidos).toEqual([FOTO, OTRA_FOTO].sort());
  });

  it("el aviso nombra el dato y da LAS DOS salidas, sin acusar", () => {
    const a = avisoHechosPerdidosEnEdicion([{ tipo: "imagen", valor: FOTO }]);
    expect(a).toContain(FOTO);
    // Reponer si no se lo pidieron…
    expect(a).toMatch(/reponlo AHORA/i);
    // … y decírselo al usuario si sí.
    expect(a).toMatch(/DÍSELO al usuario/);
    // Y nombra el camino por el que de verdad pasa.
    expect(a).toMatch(/contraste/i);
  });
});
