import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { avisosDelTurno, buildAgentContext, buildAgentMessages, estimateContextTokens } from "./context";
import { buildFunctionDeclarations } from "./catalog";
import { BEHAVIOR_ORDER, BEHAVIORS } from "@/lib/conductas-heredadas/registry";
import { todayLine } from "@/lib/ai/today-line";

// El bloque HOY se compone desde `todayLine`, la fuente unica. Fijarlo como
// literal es lo que dejo al Agente y a la puerta de generar diciendo cosas
// distintas sobre la misma fecha.
const HOY = (now: Date) =>
  `${todayLine(now).trimEnd()} Además: cualquier fecha que escribas (cuentas regresivas, eventos, plazos) tiene que ser POSTERIOR a hoy, salvo que el usuario pida explícitamente una pasada.

`;

describe("buildAgentContext", () => {
  // LEN 2.0: EL SITIO SON FICHEROS. El documento con `data-op-id` ya no viaja
  // en el contexto: Len lo lee con Read, como Claude Code, que no recibe los
  // ficheros del proyecto pegados al mensaje. Lo que sí recibe es qué hay
  // (`ficheros` en el ESTADO) y qué tiene abierto el dueño.
  it("lleva el ESTADO y el brief, y NINGÚN documento ni id inyectado", () => {
    const s = buildAgentContext({
      state: { publicado: false, ficheros: ["/index.html"], modulos: { members: false } },
      userBrief: "Negocio de tacos",
    });
    expect(s).toContain("ESTADO DEL PROYECTO");
    expect(s).toContain('"members": false');
    expect(s).toContain('"/index.html"');
    expect(s).toContain("PROJECT BRIEF");
    expect(s).toContain("Negocio de tacos");
    expect(s).not.toContain("DOCUMENTO");
    expect(s).not.toContain("data-op-id");
  });
  it("omits the brief block when empty", () => {
    const s = buildAgentContext({ state: {}, userBrief: null });
    expect(s).not.toContain("PROJECT BRIEF");
  });

  it("adds an attached-image block with the URL verbatim when attachedImage is set", () => {
    const s = buildAgentContext({
      state: {},
      userBrief: null,
      attachedImage: { url: "https://images.openlen.com/foo.webp", alt: "Foto de taco" },
    });
    expect(s).toContain("IMAGEN ADJUNTA");
    expect(s).toContain("https://images.openlen.com/foo.webp");
    expect(s).toContain("Foto de taco");
    // Se coloca cambiando un `src` en el fichero: eso es Edit. El bloque tiene
    // que nombrar la puerta que existe: mandarlo a una herramienta retirada
    // (`editar_atributos`) es mandarlo a una llamada que falla.
    expect(s).toContain("con Edit");
    expect(s).not.toContain("editar_atributos");
  });

  /**
   * Y NO SE JUZGA LA URL — la escribió NUESTRO subidor, no el usuario.
   *
   * MEDIDO el 2026-08-27: Jesús adjuntó una foto suya y el Agente se NEGÓ a
   * colocarla, explicándole que esa dirección «sólo existe en tu máquina». En
   * desarrollo no hay almacenamiento en la nube, así que nuestro propio subidor
   * devuelve `localhost` — y el Agente lo leyó como un error del usuario.
   *
   * Tenía razón en el fondo mientras el publicador no supo hornear esa ruta
   * (ver `image-bake.ts`, misma fecha). Arreglado eso, la negativa es sólo una
   * foto perdida, y el remedio que ofrecía —«súbela desde el tab Contenido»—
   * era el MISMO subidor dando la MISMA dirección.
   */
  it("le dice que NO juzgue la URL de la imagen adjunta", () => {
    const s = buildAgentContext({
      state: {},
      userBrief: null,
      attachedImage: { url: "http://localhost:3000/api/projects/p1/assets/casa.png" },
    });
    expect(s).toContain("http://localhost:3000/api/projects/p1/assets/casa.png");
    expect(s).toContain("NO HABLES DE ELLA");
    expect(s).toContain("localhost");
    // Las tres cosas que hacía y que hay que impedir: negarse, poner un
    // placeholder en su lugar, y mandarle a subirla «de otra forma».
    expect(s).toContain("No te niegues");
    expect(s).toContain("no la sustituyas por un placeholder");
    expect(s).toContain("es el mismo subidor y daría la misma dirección");
    // Y lo que sí tiene que hacer en su lugar.
    expect(s).toContain("habla del DISEÑO, no de la dirección");
  });

  it("omits the attached-image block when attachedImage is absent", () => {
    const s = buildAgentContext({ state: {}, userBrief: null });
    expect(s).not.toContain("IMAGEN ADJUNTA");
  });

  // F5 — los píxeles viajan adjuntos: el bloque lo dice SOLO con visible=true.
  it("visible=true adds the PUEDES VERLA line; without it the text is the F2 shape", () => {
    const base = { state: {}, userBrief: null };
    const seen = buildAgentContext({
      ...base,
      attachedImage: { url: "https://images.openlen.com/foo.webp", visible: true },
    });
    expect(seen).toContain("PUEDES VERLA");
    const blind = buildAgentContext({
      ...base,
      attachedImage: { url: "https://images.openlen.com/foo.webp" },
    });
    expect(blind).not.toContain("PUEDES VERLA");
    expect(blind).toContain("IMAGEN ADJUNTA");
  });

  // LO QUE EL DUEÑO SEÑALÓ EN EL LIENZO, como lo cuenta Claude Code cuando el
  // usuario selecciona líneas en su IDE: fichero, líneas y el texto, dentro de un
  // `<system-reminder>`, y «puede que tenga que ver o no». Antes era un op-id
  // («Ancla tu edición principal en este data-op-id»), que Len 2.0 no ve.
  it("la selección anclada llega como las líneas de un fichero, dentro de un <system-reminder> como en Claude Code", () => {
    const s = buildAgentContext({
      state: {},
      userBrief: null,
      seleccion: { ruta: "/menu/index.html", desde: 8, hasta: 10, contenido: "<h1>\n  Tacos\n</h1>" },
    });
    expect(s).toContain(
      "<system-reminder>\nOn the canvas, the user pointed at lines 8-10 of /menu/index.html:\n<h1>\n  Tacos\n</h1>\n\nIt may or may not matter for what you are doing now.\n</system-reminder>",
    );
    expect(s).not.toContain("PIN");
  });

  it("el texto de la selección se corta a 2.000 caracteres, como en Claude Code", () => {
    const largo = "x".repeat(2500);
    const s = buildAgentContext({
      state: {},
      userBrief: null,
      seleccion: { ruta: "/index.html", desde: 1, hasta: 1, contenido: largo },
    });
    expect(s).toContain(`${"x".repeat(2000)}\n[cut here]\n\nIt may or may not`);
    expect(s).not.toContain("x".repeat(2001));
  });

  // Claude Code no tiene una selección SIN líneas: en un IDE siempre las hay.
  // Aquí puede no anclarse (el elemento pintado no está tal cual en el
  // fichero), y entonces se dice lo que se sabe —el fichero y la pista— sin
  // inventar líneas. Decisión nuestra, dicha en voz alta en `context.ts`.
  it("sin líneas, dice el fichero y la pista, y no inventa números de línea", () => {
    const s = buildAgentContext({
      state: {},
      userBrief: null,
      seleccion: { ruta: "/index.html", pista: "h1 — 'Bienvenidos'" },
    });
    expect(s).toContain(
      "<system-reminder>\nOn the canvas, the user pointed at an element of /index.html: h1 — 'Bienvenidos'\n\nIt may or may not matter for what you are doing now.\n</system-reminder>",
    );
    expect(s).not.toContain("lines");
  });

  it("sin selección no se gasta un byte", () => {
    const base = { state: {}, userBrief: null, now: new Date("2026-09-24T12:00:00Z") };
    expect(buildAgentContext({ ...base, seleccion: null })).toBe(buildAgentContext(base));
    expect(buildAgentContext(base)).not.toContain("system-reminder");
  });

  // El contexto, pinchado carácter a carácter: el bloque HOY primero —el
  // modelo no sabe qué día es— y después el ESTADO y el brief.
  it("pinchado: HOY, ESTADO y brief, en ese orden y nada más", () => {
    const state = { publicado: true };
    const userBrief = "Panadería artesanal";
    const esperado = `${HOY(new Date("2026-08-18T12:00:00Z"))}ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(state, null, 2)}\n\nPROJECT BRIEF — /memoria/proyecto.md (persistente — aplica a toda petición):\n${userBrief}\n\n`;
    expect(buildAgentContext({ state, userBrief, now: new Date("2026-08-18T12:00:00Z") })).toBe(esperado);
  });
});

describe("lo que ya se sabe roto", () => {
  const args = {
    state: {},
    userBrief: null,
    now: new Date("2026-08-22T12:00:00Z"),
  };

  // El diagnóstico existía escrito y el Agente empezaba a ciegas: quien decía
  // «los botones no funcionan» arrancaba sin lo que el sistema ya sabía.
  it("le llega el diagnóstico CONCRETO, no el código", () => {
    const s = avisosDelTurno({
      degradaciones: [
        { code: "broken_controls", detail: ['el botón data-ol-filter="tacos" no tiene rejilla que filtrar'] },
      ],
    });
    expect(s).toContain("data-ol-filter");
    expect(s).toContain("LO QUE YA SE SABE ROTO");
  });

  // Un código a secas no dice qué tocar, y del recuento ya se entera el usuario
  // por otra vía. Pagar tokens por «scripts, 12» no compra nada.
  it("una degradación sin detalle no gasta ni una línea", () => {
    // Contra `avisosDelTurno`, no contra el contexto: desde que el bloque se
    // mudó al final del mensaje, preguntárselo al contexto daba verde sin
    // comprobar nada — nunca lo lleva.
    expect(avisosDelTurno({ degradaciones: [{ code: "scripts" }] })).toBe("");
  });

  // El invariante de este módulo: una capacidad que no se usa no cuesta un byte,
  // y la caché de prefijo no se invalida para quien nunca perdió nada.
  it("sin degradaciones no se gasta un byte", () => {
    // El invariante del módulo, ahora en su sitio: el contexto es idéntico
    // —nunca las llevó desde la tarea 4— y el bloque de avisos sale vacío, así
    // que el turno limpio no paga por una capacidad que no usa.
    expect(buildAgentContext({ ...args, degradaciones: [] })).toBe(buildAgentContext(args));
    expect(avisosDelTurno({ degradaciones: [] })).toBe("");
    expect(avisosDelTurno({ degradaciones: undefined })).toBe("");
    expect(avisosDelTurno({})).toBe("");
  });

  it("se acota a ocho", () => {
    const muchas = Array.from({ length: 20 }, (_, i) => ({ code: "x", detail: [`fallo-${i}`] }));
    const s = avisosDelTurno({ degradaciones: muchas });
    expect(s).toContain("fallo-7");
    expect(s).not.toContain("fallo-8");
  });
});

describe("H07 · lo que el dueño cambió a mano llega al modelo", () => {
  const args = {
    state: {},
    userBrief: null,
    now: new Date("2026-09-22T12:00:00Z"),
  };

  it("🔴 el contexto dice qué cambió el dueño y que NO lo hizo Len", () => {
    const s = buildAgentContext({ ...args, cambiosDelDueno: ["«Clínica Vitalvet» → «Vitalvet · Urgencias 24h»"] });
    expect(s).toContain("EL DUEÑO CAMBIÓ LA PÁGINA A MANO");
    expect(s).toContain("«Clínica Vitalvet» → «Vitalvet · Urgencias 24h»");
    expect(s).toContain("NO lo hiciste tú");
  });

  it("…y también por `buildAgentMessages`, que es lo que llaman la ruta y el arnés", () => {
    const r = buildAgentMessages({
      ...args,
      prompt: "¿qué cambió?",
      history: [],
      cambiosDelDueno: ["«A» → «B»"],
      maxPromptTokens: 240_000,
    });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.ok ? r.messages : [])).toContain("EL DUEÑO CAMBIÓ LA PÁGINA A MANO");
  });

  it("BRAZO DE CONTROL: sin cambios del dueño, el contexto sale byte a byte igual", () => {
    expect(buildAgentContext({ ...args, cambiosDelDueno: [] })).toBe(buildAgentContext(args));
  });
});

describe("H08-a · lo que el dueño dijo antes de la ventana llega al modelo", () => {
  const args = {
    state: {},
    userBrief: null,
    now: new Date("2026-09-22T12:00:00Z"),
  };

  it("🔴 sus palabras van en su bloque, junto a la nota de conversación recortada", () => {
    const s = buildAgentContext({
      ...args,
      conversacionRecortada: { visibles: 12, totales: 14 },
      dichoAntes: ['todos los precios con MXN y "IVA incluido"'],
    });
    expect(s).toContain("LO QUE EL DUEÑO TE DIJO ANTES");
    expect(s).toContain('«todos los precios con MXN y "IVA incluido"»');
  });

  it("BRAZO DE CONTROL: sin nada dicho antes, el contexto sale byte a byte igual", () => {
    const rec = { conversacionRecortada: { visibles: 12, totales: 14 } };
    expect(buildAgentContext({ ...args, ...rec, dichoAntes: [] })).toBe(buildAgentContext({ ...args, ...rec }));
  });
});

describe("estimateContextTokens", () => {
  it("scales with combined content length (~chars/3.5, ceil'd)", () => {
    const userContent = "a".repeat(35);
    const systemPrompt = "b".repeat(35);
    // (35 + 35) / 3.5 = 20 exactly
    expect(estimateContextTokens(userContent, systemPrompt)).toBe(20);
  });

  it("rounds up fractional token counts", () => {
    // (1 + 0) / 3.5 = 0.2857... -> ceil to 1
    expect(estimateContextTokens("a", "")).toBe(1);
  });
});

describe("buildAgentMessages", () => {
  // RETIRADA con el interruptor: no hay decisión que recibir ni env que
  // volver a leer. El prompt del Agente es uno solo.

  // H4, parte 3: desde que el historial trae los resultados enteros, el techo
  // tiene que contarlos. Contaba sólo el `content`, y una respuesta de Read va
  // en `functionResponses`: el techo no la veía.
  it("🔴 el techo cuenta los resultados de herramientas del historial, no sólo el texto", () => {
    const base = { state: {}, userBrief: null, prompt: "sigue", maxPromptTokens: 60_000 };
    const conResultado = (n: number) => [
      { role: "user" as const, content: "lee la portada" },
      { role: "assistant" as const, content: "", functionCalls: [{ name: "Read", args: { file_path: "/index.html" } }] },
      { role: "user" as const, content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "x".repeat(n) } }] },
    ];
    expect(buildAgentMessages({ ...base, history: conResultado(1_000) }).ok).toBe(true); // brazo de control
    expect(buildAgentMessages({ ...base, history: conResultado(400_000) })).toEqual({ ok: false, reason: "too_large" });
  });

  it("el mensaje system real de Len le ofrece el JavaScript", () => {
    // ⚰️ Aquí se encendía además `OPENLEN_MODEL_JS`, borrado el 2026-08-26 y sin
    // ningún lector en producción: la prueba ya afirmaba lo que afirma hoy —que
    // el system de Len ofrece el JavaScript— sin que ese `env` cambiara nada.
    // `OPENLEN_DOC_OPS` se queda: ése sí lo lee `lib/publish/kill-switches.ts`.
    const previoDocOps = process.env.OPENLEN_DOC_OPS;
    process.env.OPENLEN_DOC_OPS = "1";
    try {
      const result = buildAgentMessages({
        state: { publicado: false },
        userBrief: null,
        prompt: "Añade un filtro interactivo",
        history: [],
        maxPromptTokens: 100_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("el fixture no debe exceder el presupuesto");

      const sentSystem = result.messages[0];
      expect(sentSystem).toEqual({ role: "system", content: result.systemPrompt });
      expect(sentSystem.content).toContain("<script>");
      // POR SUSTANCIA, NO POR ENCABEZADO. Esto afirmaba
      // `INTERACTIVIDAD — la escribes TÚ`, que es el TÍTULO de la cláusula
      // `conductas` — la que sustituye un bloque que el contrato mínimo ya no
      // tiene. Al cablear el mínimo aquí (2026-09-01) ese encabezado desaparece
      // y la sustancia se queda, que es lo que importa: que el modelo sepa que
      // su JavaScript sobrevive y que tiene que escribir las DOS mitades.
      // Sin «usa `addEventListener`, no `onclick`» desde el 2026-09-29: el
      // editor ya no borra los `on*` (lib/publish/el-on-del-modelo.test.ts).
      expect(sentSystem.content).not.toContain("addEventListener");
      expect(sentSystem.content).toContain("LAS DOS MITADES");
      expect(sentSystem.content).not.toContain("data-ol-sticky");

      // Len 2.0: el JavaScript ya no tiene herramienta propia (`editar_runtime`
      // pedía «el código COMPLETO»); se edita como cualquier trozo del fichero,
      // con Edit. Lo que el modelo lee es el system más las descripciones.
      const descripciones = buildFunctionDeclarations()
        .map((declaration) => String((declaration as { description?: unknown }).description ?? ""))
        .join("\n");
      const inputEfectivo = `${sentSystem.content}\n${descripciones}`;
      expect(inputEfectivo).not.toContain("CONDUCTA (data-ol-calc y las demás)");
      for (const name of BEHAVIOR_ORDER) {
        expect(inputEfectivo, `quedó el marcador declarativo de ${name}`).not.toContain(BEHAVIORS[name].marker);
      }
      expect(inputEfectivo).not.toContain("código COMPLETO");
      expect(inputEfectivo).not.toContain("prueba_js");
    } finally {
      if (previoDocOps === undefined) delete process.env.OPENLEN_DOC_OPS;
      else process.env.OPENLEN_DOC_OPS = previoDocOps;
    }
  });

  // ─── EL TURNO DE ASSISTANT FABRICADO (el sobre, tarea 1) ────────────────
  //
  // El último mensaje de assistant que veía el modelo antes de generar era
  // `Entendido. Tengo el estado y el documento. ¿Qué hacemos?` — prosa
  // charlatana, acabada en pregunta, que no llama a ninguna herramienta. En la
  // posición de más peso del turno, eso es un one-shot de la conducta
  // equivocada: le enseñábamos a contestar en vez de actuar.
  //
  // MATIZ: fabricar turnos de assistant no es el pecado. OpenCode también lo
  // hace (`prompt.ts:1279-1282` inyecta MAX_STEPS_PROMPT; `transform.ts:285-296`
  // inyecta "Done." para Mistral). Lo que nunca fabrica es uno que DEMUESTRE
  // charla en lugar de acción. El defecto no es fabricar: es qué se fabrica.
  it("no fabrica ningún turno de assistant cuando no hay historial", () => {
    const result = buildAgentMessages({
      state: { publicado: false },
      userBrief: null,
      prompt: "Añade un filtro interactivo",
      history: [],
      maxPromptTokens: 100_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("el fixture no debe exceder el presupuesto");

    expect(result.messages.some((m) => m.role === "assistant")).toBe(false);
  });

  // El contexto y la petición viajan en UN solo mensaje de usuario, y ese
  // mensaje es el ÚLTIMO: contexto primero, petición al final, pegada al punto
  // de generación. Es la misma forma que la tarea 4 necesita para colgar los
  // avisos por turno del final del turno y no a 35.000 caracteres de él.
  it("funde contexto y petición en el último mensaje de usuario", () => {
    const result = buildAgentMessages({
      state: { publicado: false },
      userBrief: null,
      prompt: "Añade un filtro interactivo",
      history: [],
      maxPromptTokens: 100_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("el fixture no debe exceder el presupuesto");

    const ultimo = result.messages[result.messages.length - 1];
    expect(ultimo.role).toBe("user");
    expect(ultimo.content).toContain(result.contextBlock);
    expect(ultimo.content.endsWith("Añade un filtro interactivo")).toBe(true);
    // El contexto va ANTES de la petición, no al revés.
    expect(ultimo.content.indexOf(result.contextBlock)).toBeLessThan(
      ultimo.content.lastIndexOf("Añade un filtro interactivo"),
    );
    // Y no queda un segundo mensaje de usuario suelto con el contexto.
    expect(result.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  // El historial conserva su orden y sigue estando ANTES de la petición nueva.
  it("mantiene el historial entre el system y el mensaje del turno", () => {
    const result = buildAgentMessages({
      state: { publicado: false },
      userBrief: null,
      prompt: "Ahora ponlo en dos columnas",
      history: [
        { role: "user", content: "Añade un filtro" },
        { role: "assistant", content: "Filtro añadido." },
      ],
      maxPromptTokens: 100_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("el fixture no debe exceder el presupuesto");

    expect(result.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(result.messages[1].content).toBe("Añade un filtro");
    expect(result.messages[2].content).toBe("Filtro añadido.");
    expect(result.messages[3].content).toContain(result.contextBlock);
  });
});

// ─── LA RUTA YA NO LE MANDA EL DOCUMENTO ─────────────────────────────────────
//
// Len 2.0 (plans/len-2/ficheros-plan.md, T8c): la vista recortada por pin, el
// plano B del índice y el documento etiquetado eran tres formas de meterle el
// HTML con ids en el contexto. Con Read, Grep y Glob lo lee él, entero o por
// trozos, como Claude Code. Estas guardas leen la ruta de verdad: si alguien
// vuelve a colar el documento, saltan.
describe("la ruta del Agente no le manda el documento al modelo", () => {
  const src = readFileSync(path.join(process.cwd(), "app/api/agent/route.ts"), "utf8");

  it("ni recorte por pin, ni índice, ni documento etiquetado", () => {
    expect(src).not.toContain("buildScopedView");
    expect(src).not.toContain("buildOutline");
    expect(src).not.toContain("soloIndice");
    expect(src).not.toContain("entroACiegas");
  });

  it("lo que el dueño señaló viaja como selección de líneas de un fichero", () => {
    const ctx = src.slice(src.indexOf("const argsDelTurno = {"));
    const cuerpo = ctx.slice(0, ctx.indexOf("maxPromptTokens"));
    expect(cuerpo).toContain("seleccion");
    expect(cuerpo).not.toContain("taggedHtml");
    expect(src).toContain("seleccionDelLienzo(");
  });
});

// ─── LOS AVISOS, PEGADOS AL PUNTO DE GENERACIÓN (el sobre, tarea 4) ─────────
//
// Los avisos POR TURNO —«tu turno anterior no llamó a ninguna herramienta»,
// «esto ya se sabe roto en esta página»— vivían al PRINCIPIO del bloque de
// contexto: por delante del documento, del estado y del brief, o sea a unos
// 35.000 caracteres del punto donde el modelo empieza a generar. Un aviso
// sobre el turno que acaba de pasar, enterrado detrás de todo el documento.
//
// OpenCode los cuelga como parte sintética del ÚLTIMO mensaje de usuario
// (`reminders.ts:28-35`) y los reaplica en cada step del bucle
// (`prompt.ts:1180-1184`), y sus prompts base avisan de que esos bloques
// existen y mandan (`default.txt:78`). Aquí van al final del mismo mensaje que
// lleva la petición, detrás de las palabras del usuario, y marcados para que
// no se confundan con ellas.
describe("los avisos del turno van al final, no enterrados", () => {
  const base = {
    state: { publicado: false },
    userBrief: null,
    prompt: "Ponme el titular en azul",
    history: [] as { role: "user" | "assistant"; content: string }[],
    maxPromptTokens: 100_000,
  };
  const ultimo = (r: ReturnType<typeof buildAgentMessages>) => {
    if (!r.ok) throw new Error("el fixture no debe exceder el presupuesto");
    return r.messages[r.messages.length - 1].content;
  };

  it("el aviso de turno mudo va DESPUÉS de la petición del usuario", () => {
    const c = ultimo(buildAgentMessages({ ...base, turnoAnteriorMudo: true }));
    expect(c).toContain("tu turno anterior NO llamó a ninguna herramienta");
    expect(c.indexOf("Ponme el titular en azul")).toBeLessThan(
      c.indexOf("tu turno anterior NO llamó"),
    );
  });

  it("lo que ya se sabe roto, también", () => {
    const c = ultimo(buildAgentMessages({
      ...base,
      degradaciones: [
        { code: "broken_controls", detail: ['el botón data-ol-filter="tacos" no tiene rejilla que filtrar'] },
      ],
    }));
    expect(c).toContain("LO QUE YA SE SABE ROTO");
    expect(c).toContain("data-ol-filter");
    expect(c.indexOf("Ponme el titular en azul")).toBeLessThan(c.indexOf("LO QUE YA SE SABE ROTO"));
  });

  it("van MARCADOS: el usuario no escribió eso", () => {
    // Sin la marca, el modelo los lee como parte de la petición y contesta al
    // aviso en vez de al usuario. Es la misma marca que ya usa loop.ts.
    const c = ultimo(buildAgentMessages({ ...base, turnoAnteriorMudo: true }));
    expect(c).toContain("SISTEMA (el usuario NO escribió esto)");
    expect(c.indexOf("SISTEMA (el usuario NO escribió esto)")).toBeGreaterThan(
      c.indexOf("Ponme el titular en azul"),
    );
  });

  it("y ya no viajan enterrados delante del contexto", () => {
    const c = ultimo(buildAgentMessages({ ...base, turnoAnteriorMudo: true }));
    // Si el aviso está antes que el ESTADO, es que sigue donde estaba.
    expect(c.indexOf("ESTADO DEL PROYECTO")).toBeLessThan(c.indexOf("tu turno anterior NO llamó"));
  });

  it("sin avisos, el mensaje sigue acabando en las palabras del usuario", () => {
    // El invariante que dejó la tarea 1: una capacidad que no se usa no cuesta
    // un byte, y el turno limpio queda byte a byte como estaba.
    const c = ultimo(buildAgentMessages(base));
    expect(c.endsWith("Ponme el titular en azul")).toBe(true);
    expect(c).not.toContain("SISTEMA (el usuario NO escribió esto)");
  });

  it("el contexto ya no los lleva dentro", () => {
    const ctx = buildAgentContext({
      state: {},
      userBrief: null,
      turnoAnteriorMudo: true,
      degradaciones: [{ code: "broken_controls", detail: ["algo"] }],
      now: new Date("2026-09-03T12:00:00Z"),
    });
    expect(ctx).not.toContain("tu turno anterior NO llamó");
    expect(ctx).not.toContain("LO QUE YA SE SABE ROTO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL OBJETIVO, AL MODELO — no sólo al juez.
//
// 🔴 LEN TRABAJABA A CIEGAS. La condición de parada aparecía en UN solo sitio de
// todo `lib/agent/`: la llamada al evaluador, y el mensaje que se le manda
// DESPUÉS de que el juez le diga que no. `brain.ts` y `context.ts` no la
// mencionaban ni una vez. O sea: la primera vuelta —la pagada— se gastaba sin
// que el modelo supiera a qué se le estaba midiendo, y el objetivo no le guiaba,
// le corregía.
//
// LA VARA: en Claude Code, en cuanto el objetivo se fija se le INYECTA al modelo
// como prompt, y su propio resultado de herramienta se lo promete: «you will
// receive a kickoff message confirming it». Lo sabe desde el principio.
//
// Va en `avisosDelTurno` porque aterriza al FINAL del mensaje del usuario, que
// es la posición más saliente, y porque es exactamente lo que ese bloque es:
// algo que dice el sistema y que el usuario no escribió.
// ─────────────────────────────────────────────────────────────────────────────
describe("el objetivo activo llega al modelo", () => {
  it("nombra la condición, literal", () => {
    const s = avisosDelTurno({
      objetivo: { condicion: "el pie de todas las páginas lleva mi teléfono" },
    });
    expect(s).toContain("el pie de todas las páginas lleva mi teléfono");
    expect(s).toContain("SISTEMA (el usuario NO escribió esto)");
  });

  // 🔴 BRAZO DE CONTROL, y es la regla de la casa: una capacidad que no se usa
  // no cuesta un byte. Sin objetivo el bloque queda EXACTAMENTE como estaba.
  it("sin objetivo no cuesta un byte", () => {
    expect(avisosDelTurno({})).toBe("");
    expect(avisosDelTurno({ objetivo: null })).toBe("");
  });

  // Y convive con los otros avisos en vez de pisarlos: un turno puede a la vez
  // venir de una vuelta muda Y llevar objetivo.
  it("convive con el aviso de turno mudo", () => {
    const s = avisosDelTurno({
      turnoAnteriorMudo: true,
      objetivo: { condicion: "la condición" },
    });
    expect(s).toContain("NO llamó a ninguna herramienta");
    expect(s).toContain("la condición");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 PROBAR EL MENSAJE NO ES PROBAR LA ENTREGA.
//
// Las de arriba prueban que `avisosDelTurno` REDACTA el objetivo. Eso no basta:
// este repo ya tuvo un aviso que se redactaba bien y vivió UN DÍA sin llegar a
// ningún modelo, porque el puente tiraba el `content`. Esto mira el array de
// mensajes tal y como sale hacia el proveedor.
// ─────────────────────────────────────────────────────────────────────────────
describe("el objetivo llega al array de mensajes, no sólo al redactor", () => {
  const base = {
    state: { publicado: false },
    userBrief: null,
    prompt: "cambia el titular",
    history: [],
    maxPromptTokens: 100_000,
  };

  it("la condición viaja DENTRO del mensaje que se manda", () => {
    const r = buildAgentMessages({
      ...base,
      objetivo: { condicion: "el pie lleva mi teléfono 33 1234 5678" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("el fixture no debe exceder el presupuesto");
    const todo = r.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("");
    expect(todo).toContain("el pie lleva mi teléfono 33 1234 5678");
  });

  // 🔴 BRAZO DE CONTROL: sin objetivo, el array sale EXACTAMENTE igual que antes
  // de que esto existiera. Es la regla de la casa — una capacidad que no se usa
  // no cuesta un byte — y sin esta prueba «meter siempre el bloque» pasaría la
  // de arriba y le cobraría tokens a TODOS los turnos, que es la mayoría.
  it("sin objetivo, byte a byte igual", () => {
    const con = buildAgentMessages({ ...base, objetivo: null });
    const sin = buildAgentMessages({ ...base });
    expect(con.ok && sin.ok).toBe(true);
    if (!con.ok || !sin.ok) throw new Error("fixture");
    expect(JSON.stringify(con.messages)).toBe(JSON.stringify(sin.messages));
  });
});

/**
 * 🔴 DOS SITIOS ARMAN EL TURNO, Y TIENEN QUE ARMARLO IGUAL.
 *
 * `buildAgentMessages` lo llaman la ruta de producción y el arnés de evals. Si
 * sólo uno le pasa el objetivo, las evals miden un turno en el que Len NO sabe
 * cuál es su condición —el comportamiento viejo— y lo reportan como si fuera el
 * nuevo. Un PASS que mide otra cosa es peor que un fallo.
 *
 * Pasó de verdad: al alinearlos el 2026-09-09, el arnés no lo pasaba. Se cazó
 * ANTES de gastar una corrida, mirando el fuente.
 *
 * Es la misma guarda que `aviso-medido.test.ts` le puso a `medirParaElModelo`.
 */
describe("la ruta y el arnés le pasan el objetivo al mismo ensamblado", () => {
  const lee = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("la ruta de producción se lo pasa", () => {
    expect(
      lee("app/api/agent/route.ts"),
      "la ruta dejó de pasarle el objetivo al contexto: Len vuelve a trabajar a ciegas",
    ).toContain("objetivo: objetivoActivo ?? null");
  });

});
