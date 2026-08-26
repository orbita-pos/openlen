import { describe, expect, it } from "vitest";

import { capsulaDePagina, columnasDeRuntime } from "./page-runtimes";
import { authorizeRuntimeForPublish, buildCapsule } from "./model-runtime";

const projectId = "p1";
const capsulaDe = (html: string, code: string) => buildCapsule({ projectId, html, code });
const C1 = capsulaDe("<p>a</p>", "1");
const C2 = capsulaDe("<p>b</p>", "2");

describe("capsulaDePagina — de quién es cada cápsula", () => {
  const fila = { generatedRuntime: C1, pageRuntimes: { precios: C2 } };

  it("sin página, la de la Home", () => {
    expect(capsulaDePagina(fila, null)).toBe(C1);
  });

  // `undefined` es el contrato histórico de Home: así llega desde una sesión
  // que nunca cambió de documento. Tratarlo como subpágina apagaría el piloto.
  it("undefined también es la Home", () => {
    expect(capsulaDePagina(fila, undefined)).toBe(C1);
  });

  it("con slug, la de esa página", () => {
    expect(capsulaDePagina(fila, "precios")).toBe(C2);
  });

  it("una página sin cápsula devuelve null, no la de la Home", () => {
    expect(capsulaDePagina(fila, "menu")).toBeNull();
  });

  it("una fila vacía o ausente no revienta", () => {
    expect(capsulaDePagina(null, "precios")).toBeNull();
    expect(capsulaDePagina({}, null)).toBeNull();
    expect(capsulaDePagina({ pageRuntimes: "no soy un objeto" }, "precios")).toBeNull();
  });
});

describe("columnasDeRuntime — dónde se guarda", () => {
  // Los TRES estados, y la diferencia entre los dos últimos es la que hacía
  // imposible «quítame el carrito»: con `runtime ? …` un borrado se perdía.
  it("undefined no toca NADA — ni una columna", () => {
    expect(columnasDeRuntime({ page: null, runtime: undefined })).toEqual({});
    expect(columnasDeRuntime({ page: "precios", runtime: undefined })).toEqual({});
  });

  it("la Home escribe generatedRuntime", () => {
    expect(columnasDeRuntime({ page: null, runtime: C1 })).toEqual({ generatedRuntime: C1 });
  });

  it("y la vacía con null", () => {
    expect(columnasDeRuntime({ page: null, runtime: null })).toEqual({ generatedRuntime: null });
  });

  it("una subpágina escribe su slug dentro de pageRuntimes", () => {
    expect(columnasDeRuntime({ page: "precios", runtime: C1 })).toEqual({
      pageRuntimes: { precios: C1 },
    });
  });

  // LO QUE MÁS DAÑO HARÍA. Escribir sólo `{[slug]: capsula}` reemplaza el
  // objeto entero en la base: el JavaScript de todas las demás páginas
  // desaparecería de una sentada, y sin un solo error.
  it("FUSIONA sobre lo que ya había, no lo reemplaza", () => {
    expect(
      columnasDeRuntime({ page: "menu", runtime: C2, actuales: { precios: C1 } }),
    ).toEqual({ pageRuntimes: { precios: C1, menu: C2 } });
  });

  it("borrar una subpágina deja intactas a las demás", () => {
    expect(
      columnasDeRuntime({ page: "menu", runtime: null, actuales: { precios: C1, menu: C2 } }),
    ).toEqual({ pageRuntimes: { precios: C1 } });
  });

  // Escribir una subpágina NUNCA toca la Home, y al revés. Son dos columnas
  // distintas justamente para que un `null` mal dirigido no cruce.
  it("una subpágina no toca la columna de la Home", () => {
    expect(columnasDeRuntime({ page: "precios", runtime: null })).not.toHaveProperty(
      "generatedRuntime",
    );
    expect(columnasDeRuntime({ page: null, runtime: null })).not.toHaveProperty("pageRuntimes");
  });

  it("no muta el mapa que recibe", () => {
    const actuales = { precios: C1 };
    columnasDeRuntime({ page: "menu", runtime: C2, actuales });
    expect(actuales).toEqual({ precios: C1 });
  });
});

/**
 * LO QUE ESTO VINO A ARREGLAR, medido de punta a punta.
 *
 * Antes del 2026-08-25, `authorizeRuntimeForPublish` tenía dos puertas más:
 * `varias_paginas` y `dominio_propio`. La primera no hacía lo que su nombre
 * decía — no era «las subpáginas no llevan JavaScript», era **el sitio entero
 * se queda sin él en cuanto añades la segunda página, la Home incluida**.
 */
describe("un sitio de tres páginas, cada una con lo suyo", () => {
  const env = { OPENLEN_MODEL_JS: "1" } as unknown as NodeJS.ProcessEnv;
  const home = "<!doctype html><html><body><button id=carrito></button></body></html>";
  const precios = "<!doctype html><html><body><button id=plan></button></body></html>";
  const menu = "<!doctype html><html><body><button id=filtro></button></body></html>";

  const construir = () => {
    let fila: { generatedRuntime?: unknown; pageRuntimes?: unknown } = {};
    fila = { ...fila, ...columnasDeRuntime({ page: null, runtime: capsulaDe(home, "h") }) };
    fila = {
      ...fila,
      ...columnasDeRuntime({
        page: "precios",
        runtime: capsulaDe(precios, "p"),
        actuales: fila.pageRuntimes,
      }),
    };
    fila = {
      ...fila,
      ...columnasDeRuntime({
        page: "menu",
        runtime: capsulaDe(menu, "m"),
        actuales: fila.pageRuntimes,
      }),
    };
    return fila;
  };

  const publica = (fila: object, page: string | null, html: string) =>
    authorizeRuntimeForPublish({ env, projectId, html, capsule: capsulaDePagina(fila, page) });

  it("las tres publican con su JavaScript", () => {
    const fila = construir();
    expect(publica(fila, null, home).kind).toBe("authorized");
    expect(publica(fila, "precios", precios).kind).toBe("authorized");
    expect(publica(fila, "menu", menu).kind).toBe("authorized");
  });

  it("borrar el de una página no apaga a las otras", () => {
    let fila = construir();
    fila = { ...fila, ...columnasDeRuntime({ page: "menu", runtime: null, actuales: fila.pageRuntimes }) };
    expect(publica(fila, null, home).kind).toBe("authorized");
    expect(publica(fila, "precios", precios).kind).toBe("authorized");
    expect(publica(fila, "menu", menu).kind).toBe("skipped");
  });

  // El aislamiento en el otro sentido: una cápsula que dejó de cuadrar con SU
  // documento apaga ESA página y nada más. Era lo que el hash siempre prometió,
  // y ahora se puede comprobar por página.
  it("un desajuste apaga sólo la página que lo tiene", () => {
    const fila = construir();
    const editada = precios.replace("id=plan", "id=plan-nuevo");
    expect(publica(fila, "precios", editada)).toEqual({ kind: "skipped", reason: "desajuste" });
    expect(publica(fila, null, home).kind).toBe("authorized");
  });

  it("y el interruptor sigue apagándolo todo, que es el único freno que queda", () => {
    const fila = construir();
    const off = { OPENLEN_MODEL_JS: "0" } as unknown as NodeJS.ProcessEnv;
    for (const [page, html] of [[null, home], ["precios", precios]] as [string | null, string][]) {
      expect(
        authorizeRuntimeForPublish({ env: off, projectId, html, capsule: capsulaDePagina(fila, page) }),
      ).toEqual({ kind: "skipped", reason: "apagado" });
    }
  });
});
