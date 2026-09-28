// lib/len-bench/casos/cargar.test.ts
// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cargarEncargos } from "./cargar";
import { faltaLoQueSigue } from "../validar";

describe("cargarEncargos", () => {
  it("el juego dev va en el repo y se carga sin nada fuera de él", async () => {
    expect(Array.isArray(await cargarEncargos("dev"))).toBe(true);
    // Sola tarda <1 s; con una corrida de Len-Bench en la máquina pasó de los
    // 5 s por defecto tres veces (2026-09-23/24): transformar 24 casos.
  }, 30_000);
  it("regla 4 en todo dev: cada caso declara lo que NO se pidió tocar (sin correr nada)", async () => {
    const sinDeclarar = (await cargarEncargos("dev")).filter((e) => faltaLoQueSigue(e)).map((e) => e.id);
    expect(sinDeclarar).toEqual([]);
  }, 30_000);
  it("un juego privado que no está dice QUÉ fichero buscó", async () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "lb-juegos-"));
    // Un texto en `toThrow` es una subcadena literal: la ruta va tal cual.
    await expect(cargarEncargos("sellado", raiz)).rejects.toThrow(path.join(raiz, "plans", "len-2", "sellado", "index.ts"));
  });
});
