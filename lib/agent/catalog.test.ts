import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AGENT_MODULES, MODULE_NOMBRE, PAGE_MODULES, buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";
import { clauseMarker } from "@/lib/ai/js-clause";
import { CAMPOS_APRENDIBLES } from "@/lib/business-profiles/aprender";
import { BEHAVIOR_ORDER, BEHAVIORS } from "@/lib/conductas-heredadas/registry";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";

const SALTO = String.fromCharCode(10);

const RUNTIME_HOME = { allowed: true } as const;

// La tabla completa vive en lib/ai/runtime-capability.test.ts. Aquí sólo se
// comprueba lo que el CATÁLOGO hace con ella.
//
// Lo que había aquí —«ON/subpágina deniega», «un turno ON restringe subpágina
// y recupera Home al mover el foco»— se RETIRÓ el 2026-08-25, no se debilitó:
// fijaba una verdad que expiró. La página dejó de entrar en la decisión cuando
// cada una pasó a guardar su propio JavaScript.
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
const RAW_AGENT_PROMPT_SHA256 = "a5485b5c547966a95b4cb5ed67f666038e672fec347377910e74ee3f5c62301a";
// Re-sellado el 2026-08-25 (hallazgo 9), a propósito: la descripción decía
// "TRES targets" y enumeraba CUATRO, y anunciaba `runtime` como "sólo
// op=replace" cuando `delete` ya lo retira (hallazgo 3). Dos cambios, los dos
// en el diff de lib/agent/catalog.ts de ese commit.
// OFF ya no describe el target runtime: se retiró el párrafo (1), se
// renumeraron styles/head/idioma y la regla de prueba quedó sólo para CONDUCTAS.
const RAW_EDITAR_PAGINA_SHA256 = "2799867238e5a42a09dfbdb3544546421b3908d83e2d92570085a04cd578e2e4";

describe("buildFunctionDeclarations", () => {
  // RETIRADA la variante «sin runtime»: no hay interruptor que la produzca.
  // El target `runtime` se anuncia siempre, porque el modelo siempre puede
  // escribir el JavaScript de su página.
  it("anuncia replace y delete de runtime", () => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations()
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
      "cambiar_tema",
      "aplicar_tematica",
      "preparar_marketing",
      "crear_pagina",
      "elegir_foto",
      "editar_imagen",
      "recordar_preferencia",
      "guardar_dato_del_negocio",
      "recordar_del_negocio",
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
  it('ON usa sólo target="runtime" y conserva replace + script completo + prueba', () => {
    vi.stubEnv("OPENLEN_DOC_OPS", "1");
    try {
      const d = buildFunctionDeclarations().find((x) => x.name === "editar_pagina") as any;
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
  it("el prompt dice la VERDAD sobre los formularios", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("LOS FORMULARIOS SÍ FUNCIONAN");
    expect(p).toContain("/api/f/");
    // Y le dice cómo: sin action, sin method, sin JavaScript — el publicador
    // los pone. Un action escrito a mano por el modelo NO recibiría nada.
    expect(p).toMatch(/NO le pongas action/);
  });
  // RETIRADAS el 2026-08-26 con motion, música y 3D: las tres herramientas de
  // settings salieron del catálogo. Eran presets nuestros que suplían el
  // JavaScript prohibido —una coreografía de scroll, un reproductor flotante y
  // una escena WebGL— y el modelo ahora escribe la animación, el reproductor y
  // el canvas dentro del documento, pudiendo hacer EL que la página pide.
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
  /**
   * EL ENUM SALE DE LA FUENTE. Escrito a mano se quedaría atrás el día que se
   * añada un campo —igual que le pasó al enum de módulos con Reservas— y el
   * modelo leería como válido un campo que el aplicador rechaza.
   */
  it("guardar_dato_del_negocio ofrece EXACTAMENTE los campos que se saben guardar", () => {
    const d = buildFunctionDeclarations().find(
      (x) => x.name === "guardar_dato_del_negocio",
    ) as any;
    expect(d.parameters.properties.campo.enum).toEqual([...CAMPOS_APRENDIBLES]);
    expect(d.parameters.required).toEqual(["campo", "valor"]);
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
  // INVERTIDO el 2026-08-25. Esta prueba decía «ON/subpágina no anuncia
  // runtime» y era cierta, pero describía una limitación de almacenamiento —una
  // sola columna para la cápsula— vendida como regla de producto. Ahora cada
  // página guarda la suya, así que con el interruptor encendido el prompt es el
  // MISMO en todas: el Agente no tiene por qué saber en qué documento está para
  // saber si puede escribir JavaScript.
  it("el prompt le ofrece escribir JavaScript, esté en la página que esté", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("<script>");
    expect(p).not.toContain("OpenLen NO ejecuta JavaScript de la página");
  });

  // EL PROMPT NO PUEDE OFRECER LO QUE NO EXISTE. Hasta el 2026-08-27 abría con
  // «los módulos (reservas, cuentas, chat, catálogo…) son features REALES ya
  // construidas» y quince líneas más abajo, en el mismo prompt, decía que
  // Reservas y Cuentas SE RETIRARON. Las dos frases viajaban juntas al modelo y
  // la primera es la que suena a promesa: el usuario pide reservas, el Agente
  // ya leyó que son una feature real. La lista se deriva ahora de
  // `AGENT_MODULES`; esto sujeta que siga derivándose.
  it("la frase de apertura nombra EXACTAMENTE los módulos que existen", () => {
    const p = buildAgentSystemPrompt();
    const abre = p.slice(0, p.indexOf("REGLAS DURAS")).toLowerCase();
    expect(abre).toContain(AGENT_MODULES.map((m) => MODULE_NOMBRE[m]).join(" y "));
    for (const retirado of ["reservas", "cuentas", "pedidos", "comentarios", "broadcast", "miembros"]) {
      expect(abre, `la apertura sigue ofreciendo ${retirado}, que se retiró`).not.toContain(retirado);
    }
  });

  /** El bloque del prompt que abre con `titulo`, hasta el renglón en blanco. */
  const bloqueDe = (prompt: string, titulo: string): string =>
    prompt.slice(prompt.indexOf(titulo)).split(SALTO + SALTO)[0];

  // NINGUNA FICHA SIN FUNCIÓN DETRÁS. `cambiar_motion` se retiró el 2026-08-26
  // y su ficha se quedó en HERRAMIENTAS DE SETTINGS, con instrucciones de uso:
  // el modelo leía «usa look="off" para apagarla» sobre una función que ya no
  // se declaraba. Es el mismo fallo silencioso del enum de módulos, un párrafo
  // más arriba del prompt.
  it("cada herramienta que el prompt describe está DECLARADA", () => {
    const p = buildAgentSystemPrompt();
    const declaradas = new Set(buildFunctionDeclarations().map((d) => String(d.name)));
    const bloque = bloqueDe(p, "HERRAMIENTAS DE SETTINGS:");
    const fichas = [...bloque.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(fichas.length).toBeGreaterThan(0);
    for (const t of fichas) {
      expect(declaradas, `el prompt describe ${t}, que no se declara`).toContain(t);
    }
  });

  // Y su gemela para los módulos: la lista que el prompt enumera es la misma
  // que el enum de `activar_modulo`, no una copia que se queda atrás.
  it("cada módulo que el prompt enumera está en AGENT_MODULES", () => {
    const p = buildAgentSystemPrompt();
    const bloque = bloqueDe(p, "MÓDULOS QUE PUEDES OPERAR");
    const listados = [...bloque.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(listados).toEqual([...AGENT_MODULES]);
  });

  it("voltea agente + contrato completo + CONDUCTAS sin anexar otro contrato", () => {
    const p = buildAgentSystemPrompt();

    for (const id of ["agente", "contrato-completo", "conductas"] as const) {
      expect(p).not.toContain(clauseMarker(id));
    }
    for (const mentira of [
      "NEVER your own JavaScript",
      "the script is deleted",
      "NUNCA tu propio JavaScript",
      "NUNCA tu propio JavaScript, ni una línea",
      // LAS CINCO DEL 2026-08-27. La cláusula del JavaScript ya se volteaba
      // —el prompt SÍ decía «Puedes escribir el JavaScript de la página»— pero
      // cinco reglas duras sobrevivían al cambio y decían lo contrario. Jesús
      // pidió un carrito y le contestó «un carrito de compras NO EXISTE en
      // OpenLen»: es la línea de abajo recitada casi palabra por palabra.
      //
      // Las reglas duras ganan a una cláusula suelta. Un prompt que se
      // contradice no es un prompt a medio arreglar: es el prohibitivo.
      "fuera de tu catálogo",
      "blog dinámico, buscador interno",
      "no la construyas como maqueta estática",
      "NUNCA fabriques en HTML lo que ya existe como módulo",
      "eso NO se resuelve con un script",
      // Y las CONDUCTAS, retiradas el 2026-08-23 con sus recetas.
      "una CONDUCTA quedó mal cableada",
    ]) {
      expect(p, `quedó la prohibición obsoleta: ${mentira}`).not.toContain(mentira);
    }
    for (const name of BEHAVIOR_ORDER) {
      expect(p, `quedó el marcador declarativo de ${name}`).not.toContain(BEHAVIORS[name].marker);
    }
    expect(p).not.toContain("data-ol-sticky");
    expect(p).toContain("<script>");
    expect(p).toContain("addEventListener");
    expect(p).toContain("INTERACTIVIDAD — la escribes TÚ");
    expect(p).toContain("La página tiene que funcionar SIN él");
    // LA FRONTERA ES EL SERVIDOR, NO EL CATÁLOGO. Es la frase que sustituye a
    // las cinco de arriba, y la que decide si el Agente construye un carrito o
    // se niega. Lo que NO se puede sigue dicho, y es poco y concreto.
    expect(p).toContain("LA FRONTERA NO ES TU CATÁLOGO DE HERRAMIENTAS");
    expect(p).toContain("LO QUE DE VERDAD NO SE PUEDE");
    expect(p).toContain("no hay pasarela");
    // EL CARRITO SE NOMBRA COMO POSIBLE, Y EN AFIRMATIVO.
    //
    // La primera redacción de este arreglo lo nombraba DOS VECES dentro de la
    // lista de limitaciones («un carrito puede sumar… PERO el pago se cierra
    // fuera», «un carrito, un favorito… son suyos y sólo suyos»). Medido el
    // 2026-08-27: el Agente lo leyó como el caso emblemático de lo limitado y
    // volvió a negarse — esta vez diciendo que podría hacerlo pero que sería
    // «una maqueta muerta». Un ejemplo dentro de una lista de peros ENSEÑA el
    // pero, no el ejemplo.
    expect(p).toContain("UN CARRITO SE CONSTRUYE");
    expect(p).toContain("NUNCA TE NIEGUES A CONSTRUIR ALGO PORQUE SU ESTADO SEA LOCAL");
    expect(p).not.toContain("maqueta muerta\"");
    // Y el dato que dijo mal: localStorage NO se pierde al cerrar la pestaña.
    expect(p).toContain("SOBREVIVE a cerrar la pestaña");
    // Discutirle el negocio al dueño es la otra mitad de la negativa.
    expect(p).toContain("NO DISCUTAS EL NEGOCIO DEL DUEÑO");
    expect(p).not.toContain("INTERACCIÓN CON JAVASCRIPT");
  });

  it("carries the hard rules and module knowledge", () => {
    const p = buildAgentSystemPrompt();
    // Los módulos que QUEDAN se encienden en vez de maquetarse; lo demás se
    // construye. La redacción vieja («NUNCA fabriques… login falso, calendario
    // falso») nombraba dos módulos retirados y prohibía construir lo que hoy
    // sí se puede.
    expect(p).toContain("Si algo YA EXISTE como módulo, enciéndelo");
    expect(p).toContain("Todo lo demás que viva en el navegador lo construyes TÚ");
    expect(p).toContain("activar_modulo");
    for (const m of AGENT_MODULES) expect(p).toContain(m);
    expect(p).toContain("data-op-id");
    expect(p).toContain("data-slot-path");
  });
  // MOTION, MÚSICA Y 3D salieron de esta lista el 2026-08-26 con sus
  // herramientas. Lo que sigue vigilado es que el prompt conozca las que
  // quedan y todos los presets de tema.
  it("carries the F2 Task 1 + Task 2 settings-tool knowledge", () => {
    const p = buildAgentSystemPrompt();
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
  // Medido, no supuesto: con la redacción anterior DeepSeek reclamaba el
  // subdominio de MUESTRA —"mi-negocio", tomado del «p. ej.» de la propia
  // instrucción— 3 de 3 veces, y le enseñaba al usuario una tarjeta para
  // confirmar una dirección que jamás pidió. Gemini no caía, así que nada lo
  // habría delatado hasta que un usuario reclamara un nombre ajeno.
  //
  // Un ejemplo con forma de valor en la posición donde el modelo tiene que
  // NO poner un valor es una trampa, no una ayuda.
  it("nunca le ofrece al modelo un subdominio de muestra que pueda reclamar", () => {
    const p = buildAgentSystemPrompt();
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

  // RETIRADA el 2026-08-26, y es la más elocuente del barrido: fijaba que el
  // prompt le dijera al modelo «tu JavaScript NO sobrevive, la interactividad
  // es CSS o una CONDUCTA con nombre, nunca tu propio script».
  //
  // Era verdad cuando se escribió, y por eso existían las conductas: un
  // catálogo de recetas para aproximar lo que hace un `<script>`. Ahora el
  // script sobrevive porque es parte del documento, así que la frase pasó de
  // ser un aviso honesto a ser una mentira — y una prueba que la exigía la
  // habría mantenido viva.

  it("carries the Task 17 conectar_datos_vivos knowledge: SSRF allowlist, both intents, read-only Collection", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("conectar_datos_vivos");
    expect(p).toContain("docs.google.com");
    expect(p).toContain("data-ol-live");
    expect(p.toLowerCase()).toContain("solo lectura");
    expect(p).toContain('intent="lista"');
    expect(p).toContain('intent="valores"');
  });
  it("carries the link rule: user URLs verbatim, absolute, never invented, /<slug> for internal pages", () => {
    const p = buildAgentSystemPrompt();
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
