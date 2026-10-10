import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS_POR_FOTO, avisosDelTurno, buildAgentContext, buildAgentMessages, estimateContextTokens } from "./context";
import { buildFunctionDeclarations } from "./catalog";
import { esAdjuntoDelManual } from "./ficheros/manual";
import type { MensajeDelHistorial } from "./transcripcion";
import { todayLine } from "@/lib/ai/today-line";
import { fechaLocal } from "@/lib/resultados/zona";

// Las nueve conductas `data-ol-*`, retiradas el 2026-10-04. Ningún prompt puede
// volver a enseñarlas.
const MARCADORES_DE_CONDUCTAS = ["data-ol-countdown", "data-ol-filter", "data-ol-lightbox", "data-ol-copy", "data-ol-autoplay", "data-ol-theme", "data-ol-sticky", "data-ol-tab", "data-ol-calc"];

// El bloque HOY se compone desde `todayLine`, la fuente unica. Fijarlo como
// literal es lo que dejo al Agente y a la puerta de generar diciendo cosas
// distintas sobre la misma fecha.
const HOY = (now: Date) =>
  `${todayLine(now).trimEnd()} Also: any date you write (countdowns, events, deadlines) has to be AFTER today, unless the user explicitly asks for a past one.

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
    expect(s).toContain("PROJECT STATE");
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
      attachedImages: [{ url: "https://images.openlen.com/foo.webp", alt: "Foto de taco" }],
    });
    expect(s).toContain("IMAGE ATTACHED BY THE USER");
    expect(s).toContain("https://images.openlen.com/foo.webp");
    expect(s).toContain("Foto de taco");
    // Se coloca cambiando un `src` en el fichero. Mandarlo a una herramienta
    // retirada (`editar_atributos`) es mandarlo a una llamada que falla, y desde
    // F4 tampoco nombra Edit: en el brazo «sólo terminal» se escribe con bash.
    expect(s).toContain("place it using this EXACT URL");
    expect(s).not.toContain("editar_atributos");
    expect(s).not.toMatch(/\bEdit\b/);
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
      attachedImages: [{ url: "http://localhost:3000/api/projects/p1/assets/casa.png" }],
    });
    expect(s).toContain("http://localhost:3000/api/projects/p1/assets/casa.png");
    expect(s).toContain("DON'T TALK ABOUT IT");
    expect(s).toContain("localhost");
    // Las tres cosas que hacía y que hay que impedir: negarse, poner un
    // placeholder en su lugar, y mandarle a subirla «de otra forma».
    expect(s).toContain("Don't refuse");
    expect(s).toContain("don't replace it with a placeholder");
    expect(s).toContain("it is the same uploader and it would give the same address");
    // Y lo que sí tiene que hacer en su lugar.
    expect(s).toContain("talk about the DESIGN, not the address");
  });

  it("omits the attached-image block when attachedImage is absent", () => {
    const s = buildAgentContext({ state: {}, userBrief: null });
    expect(s).not.toContain("IMAGE ATTACHED BY THE USER");
  });

  // Crear es Len: hasta 4 fotos por mensaje, cada una con su dirección y su
  // etiqueta, y la regla de Crear de no promediarlas.
  it("con varias fotos las nombra una a una, por su etiqueta, y no las promedia", () => {
    const s = buildAgentContext({
      state: {},
      userBrief: null,
      attachedImages: [
        { url: "https://images.openlen.com/logo.png", alt: "Logo", visible: true },
        { url: "https://images.openlen.com/local.jpg", visible: true },
      ],
    });
    expect(s).toContain("IMAGES ATTACHED BY THE USER (2)");
    expect(s).toContain("Image 1: https://images.openlen.com/logo.png (alt text: Logo)");
    expect(s).toContain("Image 2: https://images.openlen.com/local.jpg");
    expect(s).toContain("you CAN SEE THEM");
    expect(s).toContain("they are NOT averaged");
    expect(s).not.toContain("IMAGE ATTACHED BY THE USER:");
  });

  // F5 — los píxeles viajan adjuntos: el bloque lo dice SOLO con visible=true.
  it("visible=true adds the PUEDES VERLA line; without it the text is the F2 shape", () => {
    const base = { state: {}, userBrief: null };
    const seen = buildAgentContext({
      ...base,
      attachedImages: [{ url: "https://images.openlen.com/foo.webp", visible: true }],
    });
    expect(seen).toContain("CAN SEE IT");
    const blind = buildAgentContext({
      ...base,
      attachedImages: [{ url: "https://images.openlen.com/foo.webp" }],
    });
    expect(blind).not.toContain("CAN SEE IT");
    expect(blind).toContain("IMAGE ATTACHED BY THE USER");
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
    expect(s).not.toContain("pointed at lines");
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
    const esperado = `${HOY(new Date("2026-08-18T12:00:00Z"))}PROJECT STATE (real, read from the server just now):\n${JSON.stringify(state, null, 2)}\n\nPROJECT BRIEF — /memoria/proyecto.md (persistent — applies to every request):\n${userBrief}\n\n`;
    expect(buildAgentContext({ state, userBrief, now: new Date("2026-08-18T12:00:00Z") })).toBe(esperado);
  });

  // MEDIDO el 30/09 (corridas/2026-10-01-resultados-humo): a las 19:25 de
  // México el HOY decía el 1 de octubre (UTC) y Len llamó «ayer» a un mensaje
  // de ese día. La zona del turno manda.
  it("HOY es el día del usuario, con su zona", () => {
    const now = new Date("2026-10-01T01:25:00Z");
    expect(buildAgentContext({ state: {}, userBrief: null, now, zona: "America/Mexico_City" })).toContain("TODAY IS 2026-09-30");
  });
  it("buildAgentMessages hace llegar la zona hasta el HOY", () => {
    // Una zona cuya fecha NO sea la de UTC ahora mismo, o la prueba no prueba
    // nada: UTC+14 va un día por delante desde las 10:00 UTC y UTC−11 uno por
    // detrás hasta las 11:00 UTC; entre las dos cubren las 24 horas.
    const utc = new Date().toISOString().slice(0, 10);
    const zona = fechaLocal(new Date(), "Pacific/Kiritimati") !== utc ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
    expect(fechaLocal(new Date(), zona)).not.toBe(utc);
    const r = buildAgentMessages({ state: {}, userBrief: null, history: [], prompt: "hola", maxPromptTokens: 60_000, zona });
    expect(JSON.stringify(r)).toContain(`TODAY IS ${fechaLocal(new Date(), zona)}`);
  });

  // ENSAYO DE CAJA DEL 09/10: en el primer turno de una app (largo, con el
  // manual, el estado y las salidas de los comandos en inglés delante) Len narró
  // sus nueve pasos en inglés a un dueño que escribía en español; sólo el cierre
  // salió en español. Como el `language` de Claude Code: el idioma, por su nombre.
  it("🔴 el idioma de la interfaz va nombrado, para las notas entre pasos y para el cierre", () => {
    const c = buildAgentContext({ state: {}, userBrief: null, idioma: "es" });
    expect(c).toContain("LANGUAGE: the user's interface is in Spanish.");
    expect(c).toMatch(/Spanish unless they write in another/);
    expect(c).toMatch(/notes between your steps/);
  });
  it("sin idioma (un turno que no sale del panel), el contexto es el de siempre; y uno que no conocemos no se nombra", () => {
    const sin = buildAgentContext({ state: {}, userBrief: null, now: new Date("2026-10-01T12:00:00Z") });
    expect(sin).not.toContain("LANGUAGE:");
    expect(buildAgentContext({ state: {}, userBrief: null, now: new Date("2026-10-01T12:00:00Z"), idioma: "xx" })).toBe(sin);
  });
  it("buildAgentMessages hace llegar el idioma hasta el contexto", () => {
    const r = buildAgentMessages({ state: {}, userBrief: null, history: [], prompt: "hola", maxPromptTokens: 60_000, idioma: "pt" });
    expect(JSON.stringify(r)).toContain("the user's interface is in Portuguese");
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
    expect(s).toContain("WHAT IS ALREADY KNOWN TO BE BROKEN");
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
    expect(s).toContain("THE OWNER CHANGED THE PAGE BY HAND");
    expect(s).toContain("«Clínica Vitalvet» → «Vitalvet · Urgencias 24h»");
    expect(s).toContain("you did NOT do this");
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
    expect(JSON.stringify(r.ok ? r.messages : [])).toContain("THE OWNER CHANGED THE PAGE BY HAND");
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
    expect(s).toContain("WHAT THE OWNER TOLD YOU EARLIER");
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

  // A (2026-10-01): las fotos viajan pegadas a tu mensaje en todas las vueltas
  // y ocupan contexto como en Claude Code; el techo las cuenta (~945 tokens una
  // foto de 1672×941, medido en Fireworks).
  it("cada foto de la conversación cuenta para el techo", () => {
    const base = { state: {}, userBrief: null, prompt: "sigue", maxPromptTokens: 60_000 };
    const foto = { mimeType: "image/jpeg", dataBase64: "A" };
    expect(buildAgentMessages({ ...base, history: [{ role: "user", content: "x", images: [foto] }] }).ok).toBe(true); // brazo de control
    const muchas = Array.from({ length: Math.ceil(60_000 / TOKENS_POR_FOTO) + 1 }, () => foto);
    expect(buildAgentMessages({ ...base, history: [{ role: "user", content: "x", images: muchas }] })).toEqual({ ok: false, reason: "too_large" });
  });

  // 🔴 H15 fase 2 (02/10): lo pensado de turnos viejos vuelve en el historial y
  // cuenta para el techo. Con presión, se va PRIMERO lo pensado más viejo —como
  // la compactación de DeepSeek, cuyo resumen deja fuera el razonamiento— en vez
  // de rechazar un turno que sin ello cabe.
  it("🔴 con presión, se va primero lo pensado más viejo y el turno sigue", () => {
    const base = { state: {}, userBrief: null, prompt: "sigue", maxPromptTokens: 60_000 };
    const history: MensajeDelHistorial[] = [
      { role: "user", content: "primero" },
      { role: "assistant", content: "hecho 1", reasoning: "v".repeat(220_000) },
      { role: "user", content: "luego" },
      { role: "assistant", content: "hecho 2", reasoning: "NUEVO-PENSADO" },
    ];
    const r = buildAgentMessages({ ...base, history });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const deLen = r.messages.filter((m) => m.role === "assistant");
    expect(deLen[0]).toEqual({ role: "assistant", content: "hecho 1" });
    expect(deLen[1]).toEqual({ role: "assistant", content: "hecho 2", reasoning: "NUEVO-PENSADO" });
  });

  it("sin presión, lo pensado viaja entero", () => {
    const base = { state: {}, userBrief: null, prompt: "sigue", maxPromptTokens: 60_000 };
    const r = buildAgentMessages({ ...base, history: [{ role: "user", content: "x" }, { role: "assistant", content: "y", reasoning: "VIEJO-PENSADO" }] });
    expect(r.ok && r.messages.find((m) => m.role === "assistant")?.reasoning).toBe("VIEJO-PENSADO");
  });

  it("y si ni sin lo pensado cabe, too_large como siempre", () => {
    const base = { state: {}, userBrief: null, prompt: "sigue", maxPromptTokens: 60_000 };
    const history: MensajeDelHistorial[] = [
      { role: "user", content: "x".repeat(400_000) },
      { role: "assistant", content: "y", reasoning: "z".repeat(10_000) },
    ];
    expect(buildAgentMessages({ ...base, history })).toEqual({ ok: false, reason: "too_large" });
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
      // El JavaScript es de la plataforma: desde el paso 7 de 2.5 va en el
      // manual (/AGENTS.md) que el arnés adjunta detrás del system. Lo que el
      // modelo lee son los dos, así que lo que NO debe decir se mira en ambos.
      const manual = result.messages[1];
      expect(manual.role).toBe("user");
      expect(esAdjuntoDelManual(manual.content)).toBe(true);
      // F4: el «antes de tu propio <script>» de las librerías se mudó a /.openlen/docs;
      // lo que se mira es que el manual adjunto ofrezca el JavaScript.
      expect(manual.content).toContain("You can write the page's JavaScript");
      const loQueLee = `${sentSystem.content}\n${manual.content}`;
      // POR SUSTANCIA, NO POR ENCABEZADO. Esto afirmaba
      // `INTERACTIVIDAD — la escribes TÚ`, que es el TÍTULO de la cláusula
      // `conductas` — la que sustituye un bloque que el contrato mínimo ya no
      // tiene. Al cablear el mínimo aquí (2026-09-01) ese encabezado desaparece
      // y la sustancia se queda, que es lo que importa: que el modelo sepa que
      // su JavaScript sobrevive y que tiene que escribir las DOS mitades.
      // Sin «usa `addEventListener`, no `onclick`» desde el 2026-09-29: el
      // editor ya no borra los `on*` (lib/publish/el-on-del-modelo.test.ts).
      expect(loQueLee).not.toContain("addEventListener");
      // «LAS DOS MITADES» se movió al diagnóstico `clase-sin-estilo` el
      // 2026-09-29 (ver prompts-superficies.test.ts): ya no va en el prompt.
      expect(loQueLee).not.toContain("BOTH HALVES");
      expect(loQueLee).not.toContain("data-ol-sticky");

      // Len 2.0: el JavaScript ya no tiene herramienta propia (`editar_runtime`
      // pedía «el código COMPLETO»); se edita como cualquier trozo del fichero,
      // con Edit. Lo que el modelo lee es el system más las descripciones.
      const descripciones = buildFunctionDeclarations()
        .map((declaration) => String((declaration as { description?: unknown }).description ?? ""))
        .join("\n");
      const inputEfectivo = `${loQueLee}\n${descripciones}`;
      expect(inputEfectivo).not.toContain("CONDUCTA (data-ol-calc y las demás)");
      for (const marcador of MARCADORES_DE_CONDUCTAS) {
        expect(inputEfectivo, `quedó el marcador declarativo ${marcador}`).not.toContain(marcador);
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

  // EL MENSAJE DEL DUEÑO VA SOLO, Y EL ÚLTIMO, como en DeepSeek (su contexto
  // de entorno es OTRO mensaje: `agent.ts`, `runtimeContext.project`) y en
  // Claude Code. Antes iba pegado detrás del contexto, todo en inglés, con
  // «WHAT THE USER ASKS YOU NOW:» en medio, y en el primer turno de un proyecto
  // —sin historia en su idioma— Len empezaba a narrar en inglés a un dueño que
  // escribía en español (ensayo de caja de crear-es-len, 06/10). El contexto va
  // justo antes; la petición sigue pegada al punto de generación.
  it("la petición del dueño es el último mensaje, sola; el contexto, el de antes", () => {
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
    expect(ultimo).toEqual({ role: "user", content: "Añade un filtro interactivo" });
    const contexto = result.messages[result.messages.length - 2];
    expect(contexto.role).toBe("user");
    expect(contexto.content).toBe(result.contextBlock);
    // Los mensajes de usuario: el manual, el contexto y la petición.
    const usuario = result.messages.filter((m) => m.role === "user");
    expect(usuario).toHaveLength(3);
    expect(esAdjuntoDelManual(usuario[0].content)).toBe(true);
    expect(usuario[0].content).not.toContain(result.contextBlock);
  });

  // EL MANUAL DE LA PLATAFORMA (/AGENTS.md, paso 7 de 2.5): justo detrás del
  // system y ANTES del historial, como Claude Code sus ficheros de
  // instrucciones. Así no cambia entre peticiones y se lee de caché; el
  // contexto, que sí cambia, sigue en el último mensaje.
  it("adjunta el manual detrás del system, igual en cada petición", () => {
    const pedir = (prompt: string, history: MensajeDelHistorial[]) =>
      buildAgentMessages({ state: { publicado: false }, userBrief: null, prompt, history, maxPromptTokens: 100_000 });
    const a = pedir("Añade un filtro", []);
    const b = pedir("Ahora ponlo en dos columnas", [
      { role: "user", content: "Añade un filtro" },
      { role: "assistant", content: "Filtro añadido." },
    ]);
    if (!a.ok || !b.ok) throw new Error("el fixture no debe exceder el presupuesto");
    expect(a.messages[1]).toEqual(b.messages[1]);
    expect(a.messages[1].content).toContain("/AGENTS.md (the platform manual, managed by OpenLen; read-only):");
    expect(a.messages[1].content).toContain("THE BACKEND (Supabase)");
    expect(a.systemPrompt).not.toContain("THE BACKEND (Supabase)");
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

    // system, el manual, el historial, el contexto y la petición.
    expect(result.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "user",
      "assistant",
      "user",
      "user",
    ]);
    expect(esAdjuntoDelManual(result.messages[1].content)).toBe(true);
    expect(result.messages[2].content).toBe("Añade un filtro");
    expect(result.messages[3].content).toBe("Filtro añadido.");
    expect(result.messages[4].content).toBe(result.contextBlock);
    expect(result.messages[5].content).toBe("Ahora ponlo en dos columnas");
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
    expect(c).toContain("your previous turn did NOT call any tool");
    expect(c.indexOf("Ponme el titular en azul")).toBeLessThan(
      c.indexOf("your previous turn did NOT call"),
    );
  });

  it("lo que ya se sabe roto, también", () => {
    const c = ultimo(buildAgentMessages({
      ...base,
      degradaciones: [
        { code: "broken_controls", detail: ['el botón data-ol-filter="tacos" no tiene rejilla que filtrar'] },
      ],
    }));
    expect(c).toContain("WHAT IS ALREADY KNOWN TO BE BROKEN");
    expect(c).toContain("data-ol-filter");
    expect(c.indexOf("Ponme el titular en azul")).toBeLessThan(c.indexOf("WHAT IS ALREADY KNOWN TO BE BROKEN"));
  });

  it("y se devuelven aparte, para guardarlos con el turno (el historial los repone)", () => {
    const r = buildAgentMessages({ ...base, turnoAnteriorMudo: true });
    if (!r.ok) throw new Error("el fixture no debe exceder el presupuesto");
    expect(r.avisos).toContain("your previous turn did NOT call any tool");
    expect(ultimo(r).endsWith(r.avisos)).toBe(true);
    const sin = buildAgentMessages(base);
    expect(sin.ok && sin.avisos).toBe("");
  });

  it("van MARCADOS: el usuario no escribió eso", () => {
    // Sin la marca, el modelo los lee como parte de la petición y contesta al
    // aviso en vez de al usuario. Es la misma marca que ya usa loop.ts.
    const c = ultimo(buildAgentMessages({ ...base, turnoAnteriorMudo: true }));
    expect(c).toContain("SYSTEM (the user did NOT write this)");
    expect(c.indexOf("SYSTEM (the user did NOT write this)")).toBeGreaterThan(
      c.indexOf("Ponme el titular en azul"),
    );
  });

  it("y ya no viajan enterrados delante del contexto", () => {
    const c = ultimo(buildAgentMessages({ ...base, turnoAnteriorMudo: true }));
    // Si el aviso está antes que el ESTADO, es que sigue donde estaba.
    expect(c.indexOf("PROJECT STATE")).toBeLessThan(c.indexOf("your previous turn did NOT call"));
  });

  it("sin avisos, el mensaje sigue acabando en las palabras del usuario", () => {
    // El invariante que dejó la tarea 1: una capacidad que no se usa no cuesta
    // un byte, y el turno limpio queda byte a byte como estaba.
    const c = ultimo(buildAgentMessages(base));
    expect(c.endsWith("Ponme el titular en azul")).toBe(true);
    expect(c).not.toContain("SYSTEM (the user did NOT write this)");
  });

  it("el contexto ya no los lleva dentro", () => {
    const ctx = buildAgentContext({
      state: {},
      userBrief: null,
      turnoAnteriorMudo: true,
      degradaciones: [{ code: "broken_controls", detail: ["algo"] }],
      now: new Date("2026-09-03T12:00:00Z"),
    });
    expect(ctx).not.toContain("your previous turn did NOT call");
    expect(ctx).not.toContain("WHAT IS ALREADY KNOWN TO BE BROKEN");
  });
});

// Crear es Len: la referencia por URL viaja con el mensaje, el mismo bloque que Crear.
describe("buildAgentContext — la referencia por URL", () => {
  const direccion = {
    hostname: "",
    palette: [{ role: "bg", hex: "#112233" }],
    polarity: "dark" as const,
    fontFamily: "Inter",
    radius: "soft" as const,
  };
  it("con referencia, el bloque de Crear cierra el contexto", () => {
    const s = buildAgentContext({ state: {}, userBrief: null, styleDirection: direccion });
    expect(s).toContain("<visual-direction>");
    expect(s).toContain("#112233 (bg)");
    expect(s.trimEnd().endsWith("</visual-direction>")).toBe(true);
  });
  it("sin ella, ni rastro", () => {
    expect(buildAgentContext({ state: {}, userBrief: null })).not.toContain("<visual-direction>");
  });
});

describe("el chat del equipo en el contexto", () => {
  it("🔴 la regla del equipo sólo con miembros; sin ella el contexto es el de siempre", () => {
    const base = { state: {}, userBrief: null, now: new Date(Date.UTC(2026, 9, 7)) };
    expect(buildAgentContext(base)).toBe(buildAgentContext({ ...base, equipo: false }));
    expect(buildAgentContext({ ...base, equipo: true }).startsWith("THIS PROJECT IS SHARED.")).toBe(true);
  });
});
