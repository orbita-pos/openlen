// lib/agent/terminal/declaracion.test.ts — lo que ve el modelo con y sin la terminal (F1).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { NOMBRE_BASH, PARA_LA_TERMINAL, PARA_SOLO_LA_TERMINAL, soloTerminal, terminalEncendida } from "./declaracion";

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

// F4 (plans/len-agente-2026), punto 4: el brazo «sólo terminal», como el modo
// mínimo de DeepSeek. Sólo para medirlo.
describe("la palanca del brazo «sólo terminal»", () => {
  const SOLO = { OPENLEN_TERMINAL: "1", OPENLEN_SOLO_TERMINAL: "1" };
  const todo = (env: Record<string, string>) => [textos(env), buildManualDeLaPlataforma(env)].join("\n");

  it("sólo vale con la terminal encendida, y sólo con el literal \"1\"", () => {
    expect(soloTerminal(SOLO)).toBe(true);
    expect(soloTerminal({ OPENLEN_SOLO_TERMINAL: "1" })).toBe(false);
    for (const v of [undefined, "0", "true", ""]) expect(soloTerminal({ OPENLEN_TERMINAL: "1", OPENLEN_SOLO_TERMINAL: v })).toBe(false);
  });

  it("con ella: bash y nada más para los ficheros; lo demás se queda", () => {
    const n = nombres(SOLO);
    expect(n).toContain(NOMBRE_BASH);
    for (const fuera of ["Read", "Edit", "Write", "Grep", "Glob"]) expect(n).not.toContain(fuera);
    for (const queda of ["mirar_pagina", "usar_pagina", "publicar", "preguntar", "revertir_ultimo_cambio", "web_search"]) expect(n).toContain(queda);
  });

  it("🔴 con ella, ni el prompt, ni las descripciones, ni /AGENTS.md nombran una herramienta que no tiene", () => {
    // «Read-only» no es la herramienta.
    expect(todo(SOLO)).not.toMatch(/\b(Read|Edit|Write|Grep|Glob)\b(?!-)/);
  });

  it("cada sustitución encuentra su frase en lo que lee el modelo con la terminal", () => {
    const conTerminal = [
      buildAgentSystemPrompt(CON),
      ...buildFunctionDeclarations(CON).map((d) => JSON.stringify(d)),
      buildManualDeLaPlataforma(CON),
    ].join("\n");
    expect(PARA_SOLO_LA_TERMINAL.map(([de]) => de).filter((de) => !conTerminal.includes(de))).toEqual([]);
  });

  it("sin ella (sólo la terminal), todo sale como en el brazo de la terminal", () => {
    expect(todo({ OPENLEN_TERMINAL: "1", OPENLEN_SOLO_TERMINAL: "0" })).toBe(todo(CON));
    expect(nombres(CON)).toEqual(expect.arrayContaining(["Read", "Edit", "Write"]));
    // Y la palanca sola, sin la terminal, no cambia nada.
    expect(todo({ OPENLEN_SOLO_TERMINAL: "1" })).toBe(todo(SIN));
  });
});
