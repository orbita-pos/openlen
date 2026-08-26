import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AGENT_MODULES, MOTION_LOOKS, PAGE_MODULES, buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";
import { clauseMarker } from "@/lib/ai/js-clause";
import { BEHAVIOR_ORDER, BEHAVIORS } from "@/lib/behaviors/registry";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import {
  runtimeCapabilityForPage,
  runtimeMutationCapability,
} from "@/lib/ai/runtime-capability";

const OFF = { OPENLEN_MODEL_JS: "0" } as const;
const ON = { OPENLEN_MODEL_JS: "1" } as const;
const RUNTIME_OFF = { allowed: false, reason: "off" } as const;
const RUNTIME_SUBPAGE = { allowed: false, reason: "subpage" } as const;
const RUNTIME_HOME = { allowed: true } as const;

describe("runtimeMutationCapability", () => {
  it.each([
    ["OFF/Home", OFF, null, { allowed: false, reason: "off" }],
    ["ON/subpágina", ON, "menu", { allowed: false, reason: "subpage" }],
    ["ON/Home null", ON, null, { allowed: true }],
    ["ON/Home undefined", ON, undefined, { allowed: true }],
  ] as const)("%s", (_caso, env, page, expected) => {
    expect(runtimeMutationCapability(env, page)).toEqual(expected);
  });

  it("un turno OFF no puede encenderse al cambiar de página", () => {
    const off = runtimeMutationCapability(OFF, "menu");
    expect(runtimeCapabilityForPage(off, null)).toEqual({ allowed: false, reason: "off" });
  });

  it("un turno ON restringe subpágina y recupera Home al mover el foco", () => {
    const home = runtimeMutationCapability(ON, null);
    const menu = runtimeCapabilityForPage(home, "menu");
    expect(menu).toEqual({ allowed: false, reason: "subpage" });
    expect(runtimeCapabilityForPage(menu, null)).toEqual({ allowed: true });
  });
});
// Pin byte a byte del prompt crudo anterior al interruptor de JavaScript.
// Un snapshot textual duplicaría 38 KiB; el SHA-256 fija exactamente los mismos
// bytes y deja las aserciones semánticas de abajo legibles.
// Re-sellado el 2026-08-25, a propósito y con el diff revisado línea a línea:
// el prompt dejó de ofrecer "Pedidos por WhatsApp" y "Reservas para citas"
// —los dos módulos se retiraron el 2026-08-21— y pasó a declararlos retirados,
// y `crear_pagina` dejó de anunciar modulo="bookings". Cuatro cambios, todos
// en el diff de lib/agent/catalog.ts de ese commit. El pin hizo justo su
// trabajo: cazó un cambio de prompt. Si vuelve a saltar sin que alguien haya
// tocado el prompt A PROPÓSITO, NO lo re-selles — busca qué se movió.
const RAW_AGENT_PROMPT_SHA256 = "a371e9d4786ae6cb9097a6530f624ff8af9e9ec80087beb2222c484448177388";
// Re-sellado el 2026-08-25 (hallazgo 9), a propósito: la descripción decía
// "TRES targets" y enumeraba CUATRO, y anunciaba `runtime` como "sólo
// op=replace" cuando `delete` ya lo retira (hallazgo 3). Dos cambios, los dos
// en el diff de lib/agent/catalog.ts de ese commit.
// OFF ya no describe el target runtime: se retiró el párrafo (1), se
// renumeraron styles/head/idioma y la regla de prueba quedó sólo para CONDUCTAS.
const RAW_EDITAR_PAGINA_SHA256 = "2799867238e5a42a09dfbdb3544546421b3908d83e2d92570085a04cd578e2e4";

describe("buildFunctionDeclarations", () => {
  it.each([
    ["OFF/Home", OFF, RUNTIME_OFF],
    ["ON/subpágina", ON, RUNTIME_SUBPAGE],
  ] as const)("%s no anuncia target runtime", (_caso, env, capability) => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations(env, capability)
        .find((x) => x.name === "editar_pagina") as { description: string };
      expect(d.description).not.toContain('target="runtime"');
      expect(d.description).not.toContain('"runtime"');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("ON/Home sí anuncia replace y delete de runtime", () => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations(ON, RUNTIME_HOME)
        .find((x) => x.name === "editar_pagina") as { description: string };
      expect(d.description).toContain('target="runtime"');
      expect(d.description).toContain('op="replace"');
      expect(d.description).toContain('op="delete"');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("declares exactly the F1 + F2 + F3 Task 1 tools", () => {
    const names = buildFunctionDeclarations().map((d) => d.name);
    expect(names).toEqual([
      "leer_estado",
      "editar_pagina",
      "redisenar_pagina",
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
      "conectar_datos_vivos",
    ]);
  });
  // 🔴 El esquema NO puede anunciar un módulo retirado. Este enum estaba
  // escrito a mano como ["bookings","collections"] y se quedó atrás cuando
  // Reservas se retiró (2026-08-21): el modelo lo leía como válido, lo
  // mandaba, y el boundary lo convertía en undefined sin decir nada.
  it("crear_pagina expone slug/titulo/modulo, y el enum sale de PAGE_MODULES", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "crear_pagina") as any;
    expect(d.parameters.properties.slug.type).toBe("STRING");
    expect(d.parameters.properties.titulo.type).toBe("STRING");
    expect(d.parameters.properties.modulo.enum).toEqual([...PAGE_MODULES]);
    expect(d.parameters.properties.modulo.enum).not.toContain("bookings");
    expect(d.parameters.required).toBeUndefined();
  });
  it("y la descripción tampoco le ofrece bookings al modelo", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "crear_pagina") as any;
    expect(d.description).not.toContain("bookings");
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
  it("OFF fija byte por byte la declaración sin runtime y con CONDUCTA", () => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations(OFF).find((x) => x.name === "editar_pagina") as any;
      const description = String(d.description);
      expect(createHash("sha256").update(description).digest("hex")).toBe(RAW_EDITAR_PAGINA_SHA256);
      expect(description).toContain("CONDUCTA (data-ol-calc y las demás)");
      expect(description).toContain("conducta mal cableada");
      expect(description).not.toContain('target="runtime"');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('ON usa sólo target="runtime" y conserva replace + script completo + prueba', () => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations(ON).find((x) => x.name === "editar_pagina") as any;
      const description = String(d.description);
      expect(description).not.toMatch(/conducta/i);
      for (const name of BEHAVIOR_ORDER) {
        expect(description, `quedó el marcador declarativo de ${name}`).not.toContain(BEHAVIORS[name].marker);
      }
      expect(description).toContain('target="runtime"');
      expect(description).toContain('op="replace"');
      expect(description).toContain("script COMPLETO corregido");
      expect(description).toContain("MANDA TAMBIÉN `prueba`");
      expect(description).toContain("NO es opcional");
      expect(description).toContain("no hace nada, consola limpia");
      expect(description).toContain("puede girar y no parar nunca");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each(["true", "yes", "0", ""])("OPENLEN_MODEL_JS=%j permanece en la variante OFF", (value) => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations({ OPENLEN_MODEL_JS: value })
        .find((x) => x.name === "editar_pagina") as any;
      const description = String(d.description);
      expect(description).toContain("CONDUCTA (data-ol-calc y las demás)");
      expect(createHash("sha256").update(description).digest("hex")).toBe(RAW_EDITAR_PAGINA_SHA256);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  // La otra mitad del interruptor OPENLEN_DOC_OPS: apagar el reparto sin apagar
  // el anuncio sería lo peor de los dos mundos — el modelo emite el objetivo y
  // la op desaparece. (El reparto se fija en document-ops.test.ts.)
  it("anuncia los objetivos styles/head sólo cuando están encendidos", () => {
    const desc = () =>
      String(
        (buildFunctionDeclarations(OFF).find((x) => x.name === "editar_pagina") as any).description,
      );
    const previo = process.env.OPENLEN_DOC_OPS;
    try {
      process.env.OPENLEN_DOC_OPS = "1";
      expect(desc()).toContain('"styles"');
      expect(desc()).toContain('"head"');
      expect(desc()).not.toContain('"runtime"');

      process.env.OPENLEN_DOC_OPS = "0";
      expect(desc()).not.toContain('"styles"');
      expect(desc()).not.toContain('"head"');
      expect(desc()).not.toContain('"runtime"');
    } finally {
      if (previo === undefined) delete process.env.OPENLEN_DOC_OPS;
      else process.env.OPENLEN_DOC_OPS = previo;
    }
  });
  // MEDIDO el 2026-08-22 con el modelo real: a «ponme un formulario para que me
  // manden su cotización» contestaba que «OpenLen no tiene un módulo de
  // formularios que guarde o envíe los datos» y que «sería un formulario
  // muerto, no te lo recomiendo» — 4 de 6 turnos no tocaban la página. Las dos
  // afirmaciones son FALSAS: lib/publish/forms.ts hornea el action al publicar
  // y app/api/f/[sub] entrega al correo del dueño y a su Bandeja. Con la verdad
  // en el prompt: 10/10 construyen el formulario. Este pin evita que la línea
  // se pierda en una futura poda del prompt.
  it("el prompt dice la VERDAD sobre los formularios", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("LOS FORMULARIOS SÍ FUNCIONAN");
    expect(p).toContain("/api/f/");
    // Y le dice cómo: sin action, sin method, sin JavaScript — el publicador
    // los pone. Un action escrito a mano por el modelo NO recibiría nada.
    expect(p).toMatch(/NO le pongas action/);
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
  it("conectar_datos_vivos requires sheet_url + intent, intent enum is lista|valores", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "conectar_datos_vivos") as any;
    expect(d.parameters.type).toBe("OBJECT");
    expect(d.parameters.properties.sheet_url.type).toBe("STRING");
    expect(d.parameters.properties.intent.enum).toEqual(["lista", "valores"]);
    expect(d.parameters.required).toEqual(["sheet_url", "intent"]);
    // The SSRF allowlist + read-only-Collection consequence must be conveyed
    // to the model, not just enforced silently.
    expect(String(d.description)).toContain("docs.google.com");
    expect(String(d.description).toLowerCase()).toContain("solo lectura");
  });
});

describe("buildAgentSystemPrompt", () => {
  it("ON/subpágina conserva el contrato sin JavaScript y no anuncia runtime", () => {
    const p = buildAgentSystemPrompt(ON, RUNTIME_SUBPAGE);
    expect(p).not.toContain("data-openlen-model-runtime");
    expect(p).not.toContain("INTERACTIVIDAD — la escribes TÚ");
    expect(p).toContain("OpenLen NO ejecuta JavaScript de la página");
  });

  it("OFF devuelve el prompt crudo byte por byte y conserva prohibición + CONDUCTAS", () => {
    const p = buildAgentSystemPrompt(OFF);

    expect(createHash("sha256").update(p).digest("hex")).toBe(RAW_AGENT_PROMPT_SHA256);
    expect(p).toContain(clauseMarker("agente"));
    expect(p).toContain(clauseMarker("contrato-completo"));
    expect(p).toContain(clauseMarker("conductas"));
    expect(p).toContain("data-ol-sticky");
  });

  it("ON voltea agente + contrato completo + CONDUCTAS sin anexar otro contrato", () => {
    const p = buildAgentSystemPrompt(ON);

    for (const id of ["agente", "contrato-completo", "conductas"] as const) {
      expect(p).not.toContain(clauseMarker(id));
    }
    for (const mentira of [
      "NEVER your own JavaScript",
      "the script is deleted",
      "NUNCA tu propio JavaScript",
      "NUNCA tu propio JavaScript, ni una línea",
    ]) {
      expect(p, `quedó la prohibición obsoleta: ${mentira}`).not.toContain(mentira);
    }
    for (const name of BEHAVIOR_ORDER) {
      expect(p, `quedó el marcador declarativo de ${name}`).not.toContain(BEHAVIORS[name].marker);
    }
    expect(p).not.toContain("data-ol-sticky");
    expect(p).toContain("data-openlen-model-runtime");
    expect(p).toContain("addEventListener");
    expect(p).toContain("INTERACTIVIDAD — la escribes TÚ");
    expect(p).toContain("La página tiene que funcionar SIN él");
    expect(p).toContain("feature de backend de verdad");
    expect(p).toContain("eso NO se resuelve con un script");
    expect(p).not.toContain("INTERACCIÓN CON JAVASCRIPT");
  });

  it("carries the hard rules and module knowledge", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("NUNCA fabriques");
    expect(p).toContain("activar_modulo");
    for (const m of AGENT_MODULES) expect(p).toContain(m);
    expect(p).toContain("data-op-id");
    expect(p).toContain("data-slot-path");
  });
  it("carries the F2 Task 1 + Task 2 settings-tool knowledge", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("cambiar_motion");
    expect(p).toContain("poner_musica");
    expect(p).toContain("activar_3d");
    expect(p).toContain("preparar_marketing");
    expect(p).toContain("cambiar_tema");
    for (const preset of THEME_PRESETS) expect(p).toContain(preset.id);
  });
  it("carries the F2 Task 3 aplicar_tematica knowledge, kit names, and the re-ink delta", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("aplicar_tematica");
    for (const kit of TEMATICA_PRESETS) {
      expect(p).toContain(kit.id);
      expect(p).toContain(kit.name);
    }
    expect(p).toContain("reink");
  });
  it("carries the F2 Task 4 crear_pagina knowledge", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("crear_pagina");
    expect(p).toContain("activar_modulo");
  });
  it("carries the F2 Task 5 elegir_foto knowledge and the images.openlen.com permission note", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("elegir_foto");
    expect(p).toContain("images.openlen.com");
    expect(p).toContain("editar_pagina");
  });
  it("carries the F2 Task 6 editar_imagen knowledge: on-page-only, per-turn, and the elegir_foto cross-ref", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("editar_imagen");
    expect(p).toContain("turno");
    expect(p).toContain("elegir_foto");
  });
  it("carries the F2 Task 7 publicar knowledge: always waits for the user's tap", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("publicar");
    // The hard rule — the agent never publishes directly; the tap is the gate.
    expect(p).toContain("subdominio");
    expect(p.toLowerCase()).toContain("tap");
    // The agent can add/set languages but never clear them — that's the
    // publish modal's job (the card omits `languages` when the list is empty).
    expect(p).toContain("QUITAR idiomas");
  });
  // Medido, no supuesto: con la redacción anterior DeepSeek reclamaba el
  // subdominio de MUESTRA —"mi-negocio", tomado del «p. ej.» de la propia
  // instrucción— 3 de 3 veces, y le enseñaba al usuario una tarjeta para
  // confirmar una dirección que jamás pidió. Gemini no caía, así que nada lo
  // habría delatado hasta que un usuario reclamara un nombre ajeno.
  //
  // Un ejemplo con forma de valor en la posición donde el modelo tiene que
  // NO poner un valor es una trampa, no una ayuda.
  it("nunca le ofrece al modelo un subdominio de muestra que pueda reclamar", () => {
    const p = buildAgentSystemPrompt(OFF);
    const publicar = buildFunctionDeclarations().find((d) => d.name === "publicar");
    const description = String((publicar as { description?: unknown }).description ?? "");

    for (const text of [p, description]) {
      expect(text).not.toMatch(/p\.\s?ej\.\s*[a-z0-9-]+\s*\)/i);
      expect(text).not.toContain("mi-negocio");
    }
    // Y la prohibición tiene que estar dicha, no sólo implícita.
    expect(description).toContain("NUNCA te lo inventes");
    expect(p).toContain("NUNCA lo eliges tú");
  });
  it("carries the F2 Task 8 attached-image hard rule (editar_pagina, verbatim URL)", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("IMAGEN ADJUNTA");
    expect(p).toContain("editar_pagina");
  });
  it("carries the F3 Task 1 recordar_preferencia knowledge: durable-only, never the one-off ask", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("recordar_preferencia");
    expect(p).toContain("DURABLE");
    expect(p.toLowerCase()).toContain("puntual");
    expect(p).toContain("Brief");
  });
  it("carries the F3 Task 5 knowledge that leer_estado/elegir_foto don't burn the tool budget", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("leer_estado");
    expect(p).toContain("elegir_foto");
    expect(p.toLowerCase()).toContain("no gastan tu presupuesto de acciones");
  });
  it("carries the F3 Task 7 backend-honesty rule — no fake static mockups for missing backend features", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("HONESTAMENTE");
    expect(p).toContain("Colecciones");
  });
  it("carries the F4 Task 3 trabajar_en_pagina knowledge: switch-before-edit, chained multi-page requests", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("trabajar_en_pagina");
    // Tight pins on the NEW knowledge specifically (not the T1 hard-rule line
    // or unrelated pre-existing uses of "cadena"/"página activa" elsewhere).
    expect(p).toContain("pagina_activa");
    expect(p.toLowerCase()).toContain("en cadena");
  });
  // 🔴 ESTE TEST DECÍA LO CONTRARIO. Se escribió cuando Pedidos existía y
  // nadie lo tocó al retirarlo (2026-08-21), así que exigía que el prompt
  // siguiera OFRECIENDO "Pedidos por WhatsApp" como alternativa real — es
  // decir, sujetaba al modelo a recomendar un módulo que ya no existe,
  // mientras los evals (lib/agent/evals/cases.ts) castigan exactamente eso.
  it("el prompt NO vende los módulos retirados — los declara retirados", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("SE RETIRARON");
    for (const retirado of ["Reservas", "Pedidos", "Comentarios", "Cuentas", "Broadcast"]) {
      expect(p).toContain(retirado);
    }
    // Y no como oferta: la frase que los presentaba como vía real se fue.
    expect(p).not.toContain("Pedidos por WhatsApp");
    expect(p).not.toContain("Reservas para citas");
    // La pasarela de pagos sigue siendo inexistente, como siempre.
    expect(p).toContain("pasarela de pagos");
  });
  it("y lo que SÍ existe sigue ofreciéndose", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("Colecciones para catálogo");
    expect(p).toContain("WhatsApp");
  });
  it("carries the scope guard: not a general-purpose chatbot, never invent real-world data", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("chatbot de propósito general");
    expect(p).toContain("no tienes acceso a internet");
  });
  it("tells the truth about JS: none survives, interactivity is CSS-only or a named CONDUCTA (never your own script), and an aviso must be confessed", () => {
    const p = buildAgentSystemPrompt(OFF);
    // The old lie ("procedural <script> … IS OK") is gone from the embedded
    // design guidance — every <script> is stripped before the page is saved.
    expect(p).not.toMatch(/Procedural <script>[\s\S]{0,40}IS\s*\n?\s*OK/);
    expect(p).toContain("NO JAVASCRIPT");
    // The positive replacement matters more than the ban: without a CSS
    // toolkit the model just ships the same dead <button> minus the script.
    expect(p).toContain("<details><summary>");
    expect(p).toContain("peer-checked:");
    // A <button> that isn't a form submit is inert — say so.
    expect(p.toLowerCase()).toContain("no hace nada");
    // Video is the one embed that works, and it needs a plain <a>, not an iframe.
    expect(p).toContain("`<iframe>` — stripped as well");
    expect(p).toContain("YouTube");
    // The carousel is a REAL baked power (lib/publish/carousel.ts). Left
    // undocumented, the model writes its own slider script, the sanitizer
    // deletes it, and the arrows ship dead — so the contract must be in here.
    expect(p).toContain("data-ol-row");
    expect(p).toContain('data-ol-scroll="prev"');
    expect(p).toContain("data-ol-scroller");
    // The honesty hook on the sanitizer's removal signal.
    expect(p).toContain("aviso");
    expect(p).toContain("JAMÁS afirmes que pusiste algo que fue removido");
  });
  it("carries the Task 17 conectar_datos_vivos knowledge: SSRF allowlist, both intents, read-only Collection", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("conectar_datos_vivos");
    expect(p).toContain("docs.google.com");
    expect(p).toContain("data-ol-live");
    expect(p.toLowerCase()).toContain("solo lectura");
    expect(p).toContain('intent="lista"');
    expect(p).toContain('intent="valores"');
  });
  it("carries the link rule: user URLs verbatim, absolute, never invented, /<slug> for internal pages", () => {
    const p = buildAgentSystemPrompt(OFF);
    expect(p).toContain("ENLACES");
    expect(p).toContain("VERBATIM");
    // The empty-destination fallback — an invented link is worse than none.
    expect(p).toContain('href="#"');
    // The why that makes the rule load-bearing: a scheme-less (or .html)
    // href is a relative path, and Caddy's `try_files … /index.html` serves
    // the HOME with 200 instead of 404ing — the break is invisible.
    expect(p).toContain("SILENCIOSO");
    expect(p).toContain("menu.html");
    expect(p).toContain("/<slug>");
  });
});
