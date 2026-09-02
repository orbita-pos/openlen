import { describe, expect, it } from "vitest";

import {
  avisoContenidoPerdido,
  contenidoPerdido,
  medirFragmento,
} from "./contenido-perdido";

// La tarjeta del fallo real (2026-09-02, producción): se pidió centrarla y
// quitarle los círculos del borde, y desapareció entera.
const TARJETA = `<div data-op-id="4h" class="ticket-stub rounded-2xl bg-white p-8">
  <p class="text-xs uppercase">Early bird</p>
  <p class="text-4xl font-bold">$99 <span class="line-through">$149</span></p>
  <p class="text-sm">OCT 15, 2026 · VIRTUAL · 9AM–5PM ET</p>
  <ul>
    <li>Acceso a los 3 tracks</li>
    <li>Grabaciones durante 12 meses</li>
    <li>Comunidad privada</li>
  </ul>
  <a href="#comprar" class="btn">Comprar entrada</a>
</div>`;

const buscar = (mapa: Record<string, string>) => (t: string) => mapa[t] ?? null;

describe("un replace que vacía lo que reemplaza", () => {
  // EL CASO QUE TRAE ESTA GUARDA. El modelo quiso quitar `ticket-stub` y, como
  // para eso tenía que reescribir el div entero, mandó sólo el envoltorio.
  it("caza el envoltorio vacío que se dejó los hijos", () => {
    const perdidos = contenidoPerdido(
      [
        {
          target: "4h",
          nuevoHtml: `<div class="rounded-2xl bg-white p-8 mx-auto"></div>`,
        },
      ],
      buscar({ "4h": TARJETA }),
    );

    expect(perdidos).toHaveLength(1);
    expect(perdidos[0].target).toBe("4h");
    expect(perdidos[0].elementosDespues).toBeLessThan(perdidos[0].elementosAntes);
  });

  // LO QUE DE VERDAD QUERÍA HACER: la misma tarjeta, sin la clase. Eso NO es
  // una pérdida y la guarda tiene que callarse.
  it("se calla cuando el replace conserva el contenido", () => {
    const perdidos = contenidoPerdido(
      [{ target: "4h", nuevoHtml: TARJETA.replace("ticket-stub ", "") }],
      buscar({ "4h": TARJETA }),
    );
    expect(perdidos).toEqual([]);
  });

  // «Simplifica esta sección» es una peticion legitima y su resultado correcto
  // es un nodo mas pequeño. Por eso esto AVISA y no rechaza — pero avisar de
  // cada retoque enseña a ignorar el aviso, asi que los minimos importan.
  it("no llora lobo cuando se reescribe un titular corto", () => {
    const perdidos = contenidoPerdido(
      [{ target: "9a", nuevoHtml: `<h2 class="text-center">Entradas</h2>` }],
      buscar({ "9a": `<h2 data-op-id="9a" class="text-left">Consigue tu entrada</h2>` }),
    );
    expect(perdidos).toEqual([]);
  });

  it("caza también el nodo que conserva las etiquetas y se deja el texto", () => {
    const antes = `<section data-op-id="2b"><h2>Precios</h2><p>Tres planes pensados para equipos que empiezan, crecen y escalan sin sorpresas en la factura.</p><p>Cancela cuando quieras, sin permanencia ni letra pequeña escondida.</p></section>`;
    const perdidos = contenidoPerdido(
      [{ target: "2b", nuevoHtml: `<section><h2>Precios</h2><p></p><p></p></section>` }],
      buscar({ "2b": antes }),
    );
    expect(perdidos).toHaveLength(1);
    expect(perdidos[0].textoDespues).toBe(7);
  });

  it("un target que no existe no inventa una pérdida", () => {
    expect(contenidoPerdido([{ target: "zz", nuevoHtml: "<p>x</p>" }], buscar({}))).toEqual([]);
  });
});

describe("medirFragmento", () => {
  // Una plantilla que documenta sus bloques inflaba el «antes» y tapaba la
  // pérdida: el comentario contaba como contenido y el porcentaje no bajaba.
  it("los comentarios no cuentan como contenido", () => {
    expect(medirFragmento(`<div><!-- una nota larguísima del autor --><p>hola</p></div>`)).toEqual({
      elementos: 2,
      texto: 4,
    });
  });

  // Sin esto, quitar un bloque de CSS embebido contaba como perder media
  // sección y la guarda hablaba cuando no debía.
  it("el CSS y el JavaScript no son texto que el usuario lea", () => {
    const m = medirFragmento(`<div><style>.a{color:red;padding:4rem 2rem}</style><p>hola</p></div>`);
    expect(m.texto).toBe(4);
  });
});

describe("el aviso", () => {
  it("nombra el nodo, los números y las dos salidas", () => {
    const aviso = avisoContenidoPerdido([
      { target: "4h", elementosAntes: 12, elementosDespues: 1, textoAntes: 180, textoDespues: 0 },
    ]);
    expect(aviso).toContain("4h");
    expect(aviso).toContain("12→1");
    // La salida de fondo: si querías tocar una clase, no era `replace`.
    expect(aviso).toContain('op="attrs"');
    expect(aviso).toContain("ESTE MISMO TURNO");
  });
});
