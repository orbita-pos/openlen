// lib/len-bench/repartir.test.ts
import { describe, expect, it } from "vitest";
import { repartir } from "./repartir";
import type { Nivel } from "./tipos";

const casos = (n: number, nivel: Nivel) => Array.from({ length: n }, (_, i) => ({ id: `${nivel}-${i}`, nivel }));
const todos = [...casos(6, "N1"), ...casos(18, "N2"), ...casos(12, "N3")];

describe("repartir", () => {
  it("es determinista con la misma semilla", () => {
    expect(repartir(todos, "2026-09-24")).toEqual(repartir(todos, "2026-09-24"));
  });
  it("cambia con otra semilla", () => {
    expect(repartir(todos, "a").sellado).not.toEqual(repartir(todos, "b").sellado);
  });
  it("reparte 2/3 a dev POR NIVEL, sin perder ni duplicar casos", () => {
    const r = repartir(todos, "x");
    const nivelDe = (id: string) => id.slice(0, 2);
    for (const [nivel, total] of [["N1", 6], ["N2", 18], ["N3", 12]] as const) {
      expect(r.dev.filter((id) => nivelDe(id) === nivel).length).toBe(Math.round((total * 2) / 3));
    }
    expect(new Set([...r.dev, ...r.sellado]).size).toBe(todos.length);
  });
  it("no depende del orden en que llegan los casos", () => {
    expect(repartir([...todos].reverse(), "x")).toEqual(repartir(todos, "x"));
  });
});
