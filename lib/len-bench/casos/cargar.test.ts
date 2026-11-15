// lib/len-bench/casos/cargar.test.ts
// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cargarEncargos } from "./cargar";
import { faltaLoQueSigue } from "../validar";
import { problemasDeLaWeb } from "../web-sustituta";

describe("cargarEncargos — el juego clientes (batería 1 de Len 3.1)", () => {
  const conCarpeta = async <T>(dir: string, fn: () => Promise<T>): Promise<T> => {
    const prev = process.env.OPENLEN_BENCH_CASES_DIR;
    process.env.OPENLEN_BENCH_CASES_DIR = dir;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.OPENLEN_BENCH_CASES_DIR;
      else process.env.OPENLEN_BENCH_CASES_DIR = prev;
    }
  };
  it("carga un caso por id de cases.json, desde la carpeta de fuera del repo", async () => {
    const ids = (JSON.parse(fs.readFileSync("lib/len-bench/casos/clientes/cases.json", "utf8")) as { projectId: string }[]).map((c) => c.projectId);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-clientes-"));
    for (const projectId of ids) {
      fs.writeFileSync(
        path.join(dir, `${projectId}.json`),
        JSON.stringify({ projectId, fetchedAt: "t", start: { html: "" }, final: { html: "<p>x</p>" }, ownerMessages: ["haz mi página"], cardAnswers: [], published: null }),
      );
    }
    const encargos = await conCarpeta(dir, () => cargarEncargos("clientes"));
    expect(encargos.map((e) => e.id)).toEqual(ids.map((id) => `cliente-${id.slice(0, 8)}`));
    expect(encargos.every((e) => e.origen === "cliente")).toBe(true);
    // Como las de `dev` de abajo: sola, ~1 s; con una validación de Len-Bench en la máquina, 4,4 s (15/11).
  }, 30_000);
  it("si falta un caso traído, dice cómo traerlo", async () => {
    await expect(conCarpeta(fs.mkdtempSync(path.join(os.tmpdir(), "lb-clientes-")), () => cargarEncargos("clientes"))).rejects.toThrow(/bench:clientes:fetch/);
  }, 30_000);
});

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
  it("el juego agente: regla 4 en cada caso, y ningún resultado de su web lleva a una página que no tiene", async () => {
    const agente = await cargarEncargos("agente");
    expect(agente.length).toBeGreaterThan(0);
    expect(agente.filter((e) => faltaLoQueSigue(e)).map((e) => e.id)).toEqual([]);
    expect(agente.flatMap((e) => (e.web ? problemasDeLaWeb(e.web).map((p) => `${e.id}: ${p}`) : []))).toEqual([]);
    // Ningún id repetido con dev: los resultados se comparan por id.
    const dev = new Set((await cargarEncargos("dev")).map((e) => e.id));
    expect(agente.map((e) => e.id).filter((id) => dev.has(id))).toEqual([]);
  }, 30_000);
  // El juego difícil (Len Dynamis contra 2.5, como DeepSeek): carga, regla 4 en
  // cada caso, y ningún id repetido con dev ni con agente.
  it("el juego hard: carga, regla 4 en cada caso, ids propios", async () => {
    const hard = await cargarEncargos("hard");
    expect(hard.length).toBeGreaterThan(0);
    expect(hard.filter((e) => faltaLoQueSigue(e)).map((e) => e.id)).toEqual([]);
    const otros = new Set([...(await cargarEncargos("dev")), ...(await cargarEncargos("agente"))].map((e) => e.id));
    expect(hard.map((e) => e.id).filter((id) => otros.has(id))).toEqual([]);
  }, 30_000);
  it("un juego privado que no está dice QUÉ fichero buscó", async () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "lb-juegos-"));
    // Un texto en `toThrow` es una subcadena literal: la ruta va tal cual.
    await expect(cargarEncargos("sellado", raiz)).rejects.toThrow(path.join(raiz, "plans", "len-2", "sellado", "index.ts"));
  });
});
