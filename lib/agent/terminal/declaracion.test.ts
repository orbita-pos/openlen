// lib/agent/terminal/declaracion.test.ts — lo que ve el modelo con y sin la terminal (F1).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { NOMBRE_BASH, PARA_LA_TERMINAL, terminalEncendida } from "./declaracion";

const CON = { OPENLEN_TERMINAL: "1" };
const SIN = {};
const nombres = (env: Record<string, string>) => buildFunctionDeclarations(env).map((d) => String(d.name));
const textos = (env: Record<string, string>) => [buildAgentSystemPrompt(env), ...buildFunctionDeclarations(env).map((d) => String(d.description ?? ""))].join("\n");

describe("la palanca de la terminal", () => {
  it("sólo el literal \"1\" la enciende", () => {
    expect(terminalEncendida(CON)).toBe(true);
    for (const v of [undefined, "0", "true", "si", ""]) expect(terminalEncendida({ OPENLEN_TERMINAL: v })).toBe(false);
  });

  it("con ella: entra bash y salen Grep y Glob; Read, Edit y Write se quedan", () => {
    expect(nombres(CON)).toContain(NOMBRE_BASH);
    expect(nombres(CON)).not.toContain("Grep");
    expect(nombres(CON)).not.toContain("Glob");
    for (const n of ["Read", "Edit", "Write"]) expect(nombres(CON)).toContain(n);
  });

  it("con ella, nada de lo que lee el modelo nombra una herramienta que no tiene; sin ella, sí (brazo de control)", () => {
    expect(textos(CON)).not.toMatch(/\bGrep\b|\bGlob\b/);
    expect(buildAgentSystemPrompt(CON)).toMatch(/\bbash\b/);
    expect(textos(SIN)).toMatch(/\bGrep\b/);
  });

  // F4: tres sustituciones se quedaron sin su frase cuando cambiaron los textos
  // (una desde `31a94a0e`) y nada lo avisó. Una que no encuentra nada es una
  // palanca a ninguna parte.
  it("cada sustitución para la terminal encuentra su frase en lo que lee el modelo sin ella", () => {
    const sinElla = [buildAgentSystemPrompt(SIN), ...buildFunctionDeclarations(SIN).map((d) => JSON.stringify(d))].join("\n");
    expect(PARA_LA_TERMINAL.map(([de]) => de).filter((de) => !sinElla.includes(de))).toEqual([]);
  });

  it("sin ella, todo sale como antes: ni bash ni un prompt distinto", () => {
    expect(nombres(SIN)).not.toContain(NOMBRE_BASH);
    expect(nombres(SIN)).toEqual(expect.arrayContaining(["Grep", "Glob"]));
    expect(buildAgentSystemPrompt(SIN)).toBe(buildAgentSystemPrompt({ OPENLEN_TERMINAL: "0" }));
  });
});
