// Qué cuenta como «el modelo pidió otra página», y qué no.
//
// Esto se lee sobre el documento que el modelo acaba de escribir, así que la
// entrada es todo lo que a un modelo se le puede ocurrir poner en un menú. Cada
// caso de aquí abajo salió de mirar cómo son las navegaciones de verdad: anclas
// para las secciones, absolutas para las redes, `mailto:` para el correo, y un
// `<span>` o un icono dentro del enlace.
import { describe, expect, it } from "vitest";

import {
  MAX_PAGINAS_DECLARADAS,
  paginasDeclaradas,
} from "./paginas-declaradas";

const nav = (...enlaces: string[]) =>
  "<!doctype html><html><body><nav>" + enlaces.join("") + "</nav></body></html>";

describe("las páginas que la portada declara", () => {
  it("una ruta de un tramo es una página, y el texto es su título", () => {
    expect(
      paginasDeclaradas(nav('<a href="/servicios">Servicios</a>')),
    ).toEqual([{ slug: "servicios", title: "Servicios" }]);
  });

  it("en el orden del menú, que es el orden en que el modelo las pensó", () => {
    expect(
      paginasDeclaradas(
        nav(
          '<a href="/">Inicio</a>',
          '<a href="/servicios">Servicios</a>',
          '<a href="/contacto">Contacto</a>',
        ),
      ).map((p) => p.slug),
    ).toEqual(["servicios", "contacto"]);
  });

  it("la barra final es la misma página", () => {
    expect(paginasDeclaradas(nav('<a href="/contacto/">Contacto</a>'))).toEqual([
      { slug: "contacto", title: "Contacto" },
    ]);
  });

  it("y una repetida no se cuenta dos veces — el pie repite el menú", () => {
    expect(
      paginasDeclaradas(
        nav('<a href="/contacto">Contacto</a>') +
          '<footer><a href="/contacto">Escríbenos</a></footer>',
      ),
    ).toEqual([{ slug: "contacto", title: "Contacto" }]);
  });

  it("el texto sale limpio aunque el enlace lleve etiquetas dentro", () => {
    expect(
      paginasDeclaradas(
        nav('<a href="/carta"><svg viewBox="0 0 1 1"></svg> <span>La carta</span></a>'),
      ),
    ).toEqual([{ slug: "carta", title: "La carta" }]);
  });

  it("y sin texto legible, el slug hace de título", () => {
    expect(
      paginasDeclaradas(nav('<a href="/carta"><svg viewBox="0 0 1 1"></svg></a>')),
    ).toEqual([{ slug: "carta", title: "carta" }]);
  });

  it("acepta comillas simples y sin comillas", () => {
    expect(paginasDeclaradas(nav("<a href='/uno'>Uno</a>")).map((p) => p.slug)).toEqual([
      "uno",
    ]);
    expect(paginasDeclaradas(nav("<a href=/dos>Dos</a>")).map((p) => p.slug)).toEqual([
      "dos",
    ]);
  });
});

describe("lo que NO es una página", () => {
  it.each([
    ["un ancla de esta misma página", '<a href="#servicios">Servicios</a>'],
    ["la portada", '<a href="/">Inicio</a>'],
    ["un destino de fuera", '<a href="https://instagram.com/x">Instagram</a>'],
    ["un correo", '<a href="mailto:hola@x.com">Escríbenos</a>'],
    ["un teléfono", '<a href="tel:+34600000000">Llámanos</a>'],
    ["el href vacío del contrato", '<a href="#">Reservar</a>'],
    ["una ruta relativa sin barra", '<a href="servicios">Servicios</a>'],
    ["un enlace sin href", "<a>Servicios</a>"],
  ])("%s", (_n, enlace) => {
    expect(paginasDeclaradas(nav(enlace))).toEqual([]);
  });

  /**
   * DOS TRAMOS NO. `ProjectData.pages` es un `Record<slug, …>` plano — el
   * modelo de páginas de OpenLen no anida. Crear `/tienda` a partir de
   * `/tienda/camisas` sería inventarse una página que el modelo no enlazó, y
   * crear `tienda/camisas` como slug lo rechaza el validador. Así que fuera.
   */
  it("una ruta anidada, porque el modelo de páginas es plano", () => {
    expect(paginasDeclaradas(nav('<a href="/tienda/camisas">Camisas</a>'))).toEqual([]);
  });

  /**
   * Y LOS SLUGS RESERVADOS, con el MISMO validador que el botón «Nueva
   * página». Tener dos criterios de qué es un slug válido es cómo se acaba con
   * una página que existe en la base de datos y no se puede publicar.
   */
  it("un slug reservado", () => {
    expect(paginasDeclaradas(nav('<a href="/api">API</a>'))).toEqual([]);
    expect(paginasDeclaradas(nav('<a href="/sitemap.xml">Mapa</a>'))).toEqual([]);
  });
});

describe("el techo", () => {
  it("coge las primeras y para", () => {
    const muchas = Array.from(
      { length: MAX_PAGINAS_DECLARADAS + 3 },
      (_, i) => `<a href="/p${i}">P${i}</a>`,
    );
    const r = paginasDeclaradas(nav(...muchas));
    expect(r).toHaveLength(MAX_PAGINAS_DECLARADAS);
    expect(r[0]!.slug).toBe("p0");
  });

  /**
   * El techo se cuenta sobre las que ENTRAN, no sobre los enlaces mirados. Un
   * menú con veinte anclas y dos páginas de verdad tiene que devolver las dos —
   * si el corte contara enlaces, las anclas se comerían el cupo y las páginas
   * reales no llegarían nunca.
   */
  it("y las anclas no gastan cupo", () => {
    const anclas = Array.from({ length: 20 }, (_, i) => `<a href="#s${i}">S${i}</a>`);
    const r = paginasDeclaradas(
      nav(...anclas, '<a href="/servicios">Servicios</a>', '<a href="/contacto">Contacto</a>'),
    );
    expect(r.map((p) => p.slug)).toEqual(["servicios", "contacto"]);
  });
});

describe("una página normal de una sola página no declara nada", () => {
  // El caso por defecto, y el más común: el modelo escribe secciones y las
  // enlaza con anclas. Si esto devolviera algo, cada generación normal se
  // llenaría de subpáginas vacías.
  it("un menú de anclas y una llamada a la acción", () => {
    const real = nav(
      '<a href="#top">Aguja Negra</a>',
      '<a href="#trabajos">Trabajos</a>',
      '<a href="#artistas">Artistas</a>',
      '<a href="#cuidados">Cuidados</a>',
      '<a href="#reservar">Reservar cita</a>',
      '<a href="https://instagram.com/agujanegra">Instagram</a>',
    );
    expect(paginasDeclaradas(real)).toEqual([]);
  });
});
