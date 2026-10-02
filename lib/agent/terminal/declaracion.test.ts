// lib/agent/terminal/declaracion.test.ts — lo que ve el modelo con y sin la terminal (F1).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { NOMBRE_BASH, terminalEncendida } from "./declaracion";

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

  it("sin ella, todo sale como antes: ni bash ni un prompt distinto", () => {
    expect(nombres(SIN)).not.toContain(NOMBRE_BASH);
    expect(nombres(SIN)).toEqual(expect.arrayContaining(["Grep", "Glob"]));
    expect(buildAgentSystemPrompt(SIN)).toBe(buildAgentSystemPrompt({ OPENLEN_TERMINAL: "0" }));
  });
});
