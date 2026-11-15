// lib/len-bench/casos/clientes/index.test.ts
// @vitest-environment node
//
// THE CUSTOMERS GAME (plan local 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 9): a real customer project,
// replayed in order, graded on its final page by a GENERIC rubric — nothing written by hand per case, so no
// customer text enters the repo.
import { describe, expect, it } from "vitest";

import { customerCase, customerGraders, customerRotas } from "./index";
import { CUMPLE_LO_PEDIDO } from "./rubric";
import type { FetchedCase } from "./fetched";

const fetched = (o: Partial<FetchedCase> = {}): FetchedCase => ({
  projectId: "00000000-0000-4000-8000-0000000000aa",
  fetchedAt: "2026-11-15T00:00:00Z",
  start: { html: "" },
  final: { html: "<html><body><h1>Tacos</h1></body></html>" },
  ownerMessages: ["hazme una página para mi taquería", "publícala"],
  cardAnswers: [{ question: "¿Qué dirección?", answer: "tacos-don-pepe" }],
  published: { subdomain: "tacos-don-pepe" },
  ...o,
});

describe("customerCase", () => {
  it("replays the owner's messages in order, from the page they started on, graded against their final page", () => {
    const e = customerCase(fetched());
    expect(e.id).toBe("cliente-00000000");
    expect(e.origen).toBe("cliente");
    expect(e.guion).toEqual([
      { tipo: "pide", mensaje: "hazme una página para mi taquería" },
      { tipo: "pide", mensaje: "publícala" },
    ]);
    expect(e.inicio).toEqual({ html: "" });
    expect(e.solucion).toEqual({ html: "<html><body><h1>Tacos</h1></body></html>" });
  });

  it("the simulated owner knows what the customer answered in the cards and where they published", () => {
    const e = customerCase(fetched());
    expect(e.ficha.datos).toEqual({ respuesta_1: "tacos-don-pepe", subdominio: "tacos-don-pepe" });
    expect(e.publicaLen).toBe(true);
  });

  it("a page never published: Len is not granted the publish card, and the ficha has no address", () => {
    const e = customerCase(fetched({ published: null, cardAnswers: [] }));
    expect(e.publicaLen).toBe(false);
    expect(e.ficha.datos).toEqual({});
  });

  it("no customer text in its summary", () => {
    expect(customerCase(fetched()).resumen).not.toMatch(/taquer|tacos/i);
  });
});

describe("customerGraders — the generic rubric", () => {
  it("publishes when Len published, there IS a page (the null fails it), invents nothing, fits a phone, keeps its links, and a judge that does not vote yet", () => {
    expect(customerGraders(fetched()).map((g) => [g.nombre, g.puntua !== false])).toEqual([
      ["len-publico", true],
      ["pagina-hecha", true],
      ["nada-inventado", true],
      ["sin-cifras-inventadas", false],
      ["sin-desborde-movil", true],
      ["enlaces-internos-van", true],
      ["ningun-enlace-roto", true],
      ["cumple-lo-pedido", false],
    ]);
    const juez = customerGraders(fetched()).at(-1)!;
    expect(juez.criterio).toBe(CUMPLE_LO_PEDIDO);
    expect(juez.foco).toBe("pedidos_y_pagina");
  });
  it("without a publish there is no len-publico", () => {
    expect(customerGraders(fetched({ published: null })).map((g) => g.nombre)).not.toContain("len-publico");
  });
  it("the criterion names no customer and no business", () => {
    expect(CUMPLE_LO_PEDIDO).not.toMatch(/taquer|tacos|cliente-/i);
  });
});

describe("customerRotas — broken on purpose, from the customer's own final page (validar.ts rule 3)", () => {
  const rotas = customerRotas(fetched());
  const html = (nombre: string) => String(rotas.find((r) => r.nombre === nombre)?.datos.html);
  it("a blank page, an invented contact, a page wider than a phone and a link to nowhere", () => {
    expect(rotas.map((r) => r.nombre)).toEqual(["pagina-en-blanco", "dato-inventado", "desborde-movil", "enlace-roto"]);
    expect(html("pagina-en-blanco")).toBe("");
  });
  it("each keeps the customer's page and adds its break before </body>", () => {
    for (const nombre of ["dato-inventado", "desborde-movil", "enlace-roto"]) {
      expect(html(nombre)).toContain("<h1>Tacos</h1>");
      expect(html(nombre).indexOf("</body>")).toBeGreaterThan(html(nombre).indexOf("<h1>Tacos</h1>"));
    }
    expect(html("dato-inventado")).toMatch(/55 1234 0000/);
    expect(html("enlace-roto")).toMatch(/href="\/pagina-que-no-existe"/);
  });
  it("a page without </body> gets the break at the end", () => {
    expect(String(customerRotas(fetched({ final: { html: "<h1>x</h1>" } }))[2]!.datos.html)).toMatch(/^<h1>x<\/h1>.*1600px/s);
  });
});
