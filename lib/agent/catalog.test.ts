import { describe, expect, it } from "vitest";
import { AGENT_MODULES, buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";

describe("buildFunctionDeclarations", () => {
  it("declares exactly the F1 tools", () => {
    const names = buildFunctionDeclarations().map((d) => d.name);
    expect(names).toEqual(["leer_estado", "editar_pagina", "activar_modulo"]);
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
});
