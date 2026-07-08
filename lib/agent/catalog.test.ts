import { describe, expect, it } from "vitest";
import { AGENT_MODULES, MOTION_LOOKS, buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { THEME_PRESETS } from "@/lib/theme-presets";

describe("buildFunctionDeclarations", () => {
  it("declares exactly the F1 + F2 Task 1 + F2 Task 2 + F2 Task 3 tools", () => {
    const names = buildFunctionDeclarations().map((d) => d.name);
    expect(names).toEqual([
      "leer_estado",
      "editar_pagina",
      "activar_modulo",
      "cambiar_motion",
      "poner_musica",
      "activar_3d",
      "cambiar_tema",
      "aplicar_tematica",
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
  it("cambiar_tema exposes accent/fuente/radius/modo, fuente+radius enums pulled from THEME_PRESETS", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "cambiar_tema") as any;
    expect(d.parameters.properties.accent.type).toBe("STRING");
    const presetIds = THEME_PRESETS.map((p) => p.id);
    expect(d.parameters.properties.fuente.enum).toEqual(presetIds);
    expect(d.parameters.properties.radius.enum).toEqual(presetIds);
    expect(d.parameters.properties.modo.enum).toEqual(["light", "dark"]);
    // No required[] — every field is optional (the tool itself enforces
    // "at least one of accent/fuente/radius" as a runtime, data-level error).
    expect(d.parameters.required).toBeUndefined();
  });
  it("aplicar_tematica exposes tematica (kit ids + quitar) and an optional fondo", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "aplicar_tematica") as any;
    const kitIds = TEMATICA_PRESETS.map((p) => p.id);
    expect(d.parameters.properties.tematica.enum).toEqual([...kitIds, "quitar"]);
    expect(d.parameters.properties.fondo.type).toBe("STRING");
    expect(d.parameters.required).toEqual(["tematica"]);
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
  it("carries the F2 Task 1 + Task 2 settings-tool knowledge", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("cambiar_motion");
    expect(p).toContain("poner_musica");
    expect(p).toContain("activar_3d");
    expect(p).toContain("preparar_marketing");
    expect(p).toContain("cambiar_tema");
    for (const preset of THEME_PRESETS) expect(p).toContain(preset.id);
  });
  it("carries the F2 Task 3 aplicar_tematica knowledge, kit names, and the re-ink delta", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("aplicar_tematica");
    for (const kit of TEMATICA_PRESETS) {
      expect(p).toContain(kit.id);
      expect(p).toContain(kit.name);
    }
    expect(p).toContain("reink");
  });
});
