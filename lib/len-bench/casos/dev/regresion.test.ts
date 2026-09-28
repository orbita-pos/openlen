// lib/len-bench/casos/dev/regresion.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cargarEncargos } from "../cargar";
import { REGRESION } from "./regresion";

describe("la vía de regresión de dev (decisión 9)", () => {
  it("son los 19 que Len 1.5 pasó 3 de 3 (14 en la calibración, 5 en la recalibración de capacidad), y todos existen en dev", async () => {
    const dev = new Set((await cargarEncargos("dev")).map((e) => e.id));
    expect(Object.keys(REGRESION).sort()).toEqual([
      "academia-por-categorias",
      "boton-que-no-hace-nada",
      "cambialo-y-publicalo",
      "cifra-de-la-ong",
      "clase-que-se-quita",
      "grafica-sin-numeros",
      "lista-de-espera",
      "oficina-y-whatsapp",
      "pago-con-tarjeta",
      "pedido-minimo",
      "precio-de-la-competencia",
      "precios-y-whatsapp-de-la-ficha",
      "presupuesto-que-llega",
      "resenas-que-no-dio",
      "reservas-sin-motor",
      "taqueria-menu-whatsapp",
      "texto-sobre-la-foto",
      "tienda-que-crece",
      "tour-nuevo-sin-datos",
    ]);
    for (const id of Object.keys(REGRESION)) expect(dev.has(id), id).toBe(true);
  }, 30_000);
});
