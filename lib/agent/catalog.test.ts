import { describe, expect, it } from "vitest";
import { AGENT_MODULES, MOTION_LOOKS, buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";

describe("buildFunctionDeclarations", () => {
  it("declares exactly the F1 + F2 + F3 Task 1 tools", () => {
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
      "crear_pagina",
      "elegir_foto",
      "editar_imagen",
      "recordar_preferencia",
      "publicar",
      "trabajar_en_pagina",
    ]);
  });
  it("crear_pagina exposes slug/titulo/modulo, modulo enum bookings|collections, nothing required", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "crear_pagina") as any;
    expect(d.parameters.properties.slug.type).toBe("STRING");
    expect(d.parameters.properties.titulo.type).toBe("STRING");
    expect(d.parameters.properties.modulo.enum).toEqual(["bookings", "collections"]);
    expect(d.parameters.required).toBeUndefined();
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
    // fondo enum = every kit's scene ids (deduped, preset order) — generated
    // from the same backdrop tables resolveBackdrop reads, never hardcoded.
    const sceneIds = Array.from(
      new Set(TEMATICA_PRESETS.flatMap((p) => p.backdrops.map((b) => b.id))),
    );
    expect(d.parameters.properties.fondo.enum).toEqual(sceneIds);
    expect(sceneIds.length).toBeGreaterThan(0);
    expect(d.parameters.required).toEqual(["tematica"]);
  });
  it("elegir_foto exposes busqueda + estilo as optional strings, nothing required", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "elegir_foto") as any;
    expect(d.parameters.properties.busqueda.type).toBe("STRING");
    expect(d.parameters.properties.estilo.type).toBe("STRING");
    // estilo is a free string (typos just yield zero matches, not an error) —
    // no enum constraint, so the model can't get stuck on an out-of-date list.
    expect(d.parameters.properties.estilo.enum).toBeUndefined();
    expect(d.parameters.required).toBeUndefined();
  });
  it("editar_imagen requires imagen_url + instruccion as strings", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "editar_imagen") as any;
    expect(d.parameters.properties.imagen_url.type).toBe("STRING");
    expect(d.parameters.properties.instruccion.type).toBe("STRING");
    expect(d.parameters.required).toEqual(["imagen_url", "instruccion"]);
    // The description must steer the model away from external URLs and toward
    // elegir_foto for brand-new photos.
    expect(String(d.description)).toContain("elegir_foto");
  });
  it("recordar_preferencia requires preferencia as a string, and the description warns off one-off asks", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "recordar_preferencia") as any;
    expect(d.parameters.properties.preferencia.type).toBe("STRING");
    expect(d.parameters.required).toEqual(["preferencia"]);
    expect(String(d.description)).toContain("DURABLE");
    expect(String(d.description).toLowerCase()).toContain("puntual");
  });
  it("publicar exposes optional subdominio + idiomas(ARRAY of STRING), nothing required, enumerates PUBLISH_LOCALES", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "publicar") as any;
    expect(d.parameters.type).toBe("OBJECT");
    expect(d.parameters.properties.subdominio.type).toBe("STRING");
    expect(d.parameters.properties.idiomas.type).toBe("ARRAY");
    expect(d.parameters.properties.idiomas.items.type).toBe("STRING");
    // Both optional — the tool asks the user for a subdomain when there's no
    // claim, rather than failing schema validation.
    expect(d.parameters.required).toBeUndefined();
    // The valid idiomas codes are enumerated in the description, generated from
    // the PUBLISH_LOCALES import (never hardcoded).
    for (const l of PUBLISH_LOCALES) expect(String(d.description)).toContain(l.code);
    // The user-tap gate must be conveyed to the model.
    expect(String(d.description).toLowerCase()).toContain("usuario");
  });
  it("trabajar_en_pagina requires pagina as a string", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "trabajar_en_pagina") as any;
    expect(d.parameters.type).toBe("OBJECT");
    expect(d.parameters.properties.pagina.type).toBe("STRING");
    expect(d.parameters.required).toEqual(["pagina"]);
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
  it("carries the F2 Task 4 crear_pagina knowledge", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("crear_pagina");
    expect(p).toContain("activar_modulo");
  });
  it("carries the F2 Task 5 elegir_foto knowledge and the images.openlen.com permission note", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("elegir_foto");
    expect(p).toContain("images.openlen.com");
    expect(p).toContain("editar_pagina");
  });
  it("carries the F2 Task 6 editar_imagen knowledge: on-page-only, per-turn, and the elegir_foto cross-ref", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("editar_imagen");
    expect(p).toContain("turno");
    expect(p).toContain("elegir_foto");
  });
  it("carries the F2 Task 7 publicar knowledge: always waits for the user's tap", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("publicar");
    // The hard rule — the agent never publishes directly; the tap is the gate.
    expect(p).toContain("subdominio");
    expect(p.toLowerCase()).toContain("tap");
    // The agent can add/set languages but never clear them — that's the
    // publish modal's job (the card omits `languages` when the list is empty).
    expect(p).toContain("QUITAR idiomas");
  });
  it("carries the F2 Task 8 attached-image hard rule (editar_pagina, verbatim URL)", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("IMAGEN ADJUNTA");
    expect(p).toContain("editar_pagina");
  });
  it("carries the F3 Task 1 recordar_preferencia knowledge: durable-only, never the one-off ask", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("recordar_preferencia");
    expect(p).toContain("DURABLE");
    expect(p.toLowerCase()).toContain("puntual");
    expect(p).toContain("Brief");
  });
  it("carries the F3 Task 5 knowledge that leer_estado/elegir_foto don't burn the tool budget", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("leer_estado");
    expect(p).toContain("elegir_foto");
    expect(p.toLowerCase()).toContain("no gastan tu presupuesto de acciones");
  });
  it("carries the F3 Task 7 backend-honesty rule — no fake static mockups for missing backend features", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("carrito");
    expect(p).toContain("HONESTAMENTE");
    expect(p).toContain("Collections");
  });
  it("carries the F4 Task 3 trabajar_en_pagina knowledge: switch-before-edit, chained multi-page requests", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("trabajar_en_pagina");
    // Tight pins on the NEW knowledge specifically (not the T1 hard-rule line
    // or unrelated pre-existing uses of "cadena"/"página activa" elsewhere).
    expect(p).toContain("pagina_activa");
    expect(p.toLowerCase()).toContain("en cadena");
  });
  it("knows Pedidos exists and no longer lists carrito as nonexistent", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("pedidos");
    expect(p).toContain("Pedidos por WhatsApp");
    // La regla de honestidad conserva pasarela de pagos como inexistente…
    expect(p).toContain("pasarela de pagos");
    // …pero ya NO puede negar el carrito (existe vía Pedidos).
    expect(p).not.toMatch(/NO la tiene[^.]*carrito/);
  });
});
