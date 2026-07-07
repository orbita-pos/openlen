import { describe, expect, it } from "vitest";
import { AGENT_MODULES, MOTION_LOOKS, buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";

describe("buildFunctionDeclarations", () => {
  it("declares exactly the F1 + F2 Task 1 tools", () => {
    const names = buildFunctionDeclarations().map((d) => d.name);
    expect(names).toEqual([
      "leer_estado",
      "editar_pagina",
      "activar_modulo",
      "cambiar_motion",
      "poner_musica",
      "activar_3d",
      "preparar_marketing",
    ]);
  });
  it("activar_modulo enum matches AGENT_MODULES", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "activar_modulo") as any;
    expect(d.parameters.properties.modulo.enum).toEqual([...AGENT_MODULES]);
    expect(d.parameters.required).toContain("modulo");
  });
  it("editar_pagina requires edits + resumen and uses UPPERCASE schema types", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "editar_pagina") as any;
    expect(d.parameters.type).toBe("OBJECT");
    expect(d.parameters.required).toEqual(["edits", "resumen"]);
    expect(d.parameters.properties.edits.items.properties.op.enum)
      .toEqual(["replace", "insert_before", "insert_after", "delete"]);
  });
  it("cambiar_motion enum matches MOTION_LOOKS", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "cambiar_motion") as any;
    expect(d.parameters.properties.look.enum).toEqual([...MOTION_LOOKS]);
    expect(d.parameters.required).toEqual(["look"]);
  });
  it("poner_musica requires accion with poner|quitar enum", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "poner_musica") as any;
    expect(d.parameters.properties.accion.enum).toEqual(["poner", "quitar"]);
    expect(d.parameters.required).toEqual(["accion"]);
  });
  it("activar_3d requires a boolean encender", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "activar_3d") as any;
    expect(d.parameters.properties.encender.type).toBe("BOOLEAN");
    expect(d.parameters.required).toEqual(["encender"]);
  });
  it("preparar_marketing requires registro as a string enum", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "preparar_marketing") as any;
    expect(d.parameters.properties.registro.type).toBe("STRING");
    expect(Array.isArray(d.parameters.properties.registro.enum)).toBe(true);
    expect(d.parameters.required).toEqual(["registro"]);
  });
});

describe("buildAgentSystemPrompt", () => {
  it("carries the hard rules and module knowledge", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("NUNCA fabriques");
    expect(p).toContain("activar_modulo");
    for (const m of AGENT_MODULES) expect(p).toContain(m);
    expect(p).toContain("data-op-id");
    expect(p).toContain("data-slot-path");
  });
  it("carries the F2 Task 1 settings-tool knowledge", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("cambiar_motion");
    expect(p).toContain("poner_musica");
    expect(p).toContain("activar_3d");
    expect(p).toContain("preparar_marketing");
  });
});
