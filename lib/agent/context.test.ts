import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentContext, buildAgentMessages, estimateContextTokens } from "./context";
import { buildFunctionDeclarations } from "./catalog";
import { FIN_DEL_DOCUMENTO } from "./loop";
import { buildOutline } from "@/lib/html-ops";
import { BEHAVIOR_ORDER, BEHAVIORS } from "@/lib/conductas-heredadas/registry";
import { todayLine } from "@/lib/ai/today-line";

// El bloque HOY se compone desde `todayLine`, la fuente unica. Fijarlo como
// literal es lo que dejo al Agente y a la puerta de generar diciendo cosas
// distintas sobre la misma fecha.
const HOY = (now: Date) =>
  `${todayLine(now).trimEnd()} Además: cualquier fecha que escribas (cuentas regresivas, eventos, plazos) tiene que ser POSTERIOR a hoy, salvo que el usuario pida explícitamente una pasada.

`;

describe("buildAgentContext", () => {
  it("carries state JSON, brief and tagged doc in labeled blocks", () => {
    const s = buildAgentContext({
      state: { publicado: false, modulos: { members: false } },
      taggedHtml: `<html data-op-id="a1"></html>`,
      userBrief: "Negocio de tacos",
    });
    expect(s).toContain("ESTADO DEL PROYECTO");
    expect(s).toContain('"members": false');
    expect(s).toContain("PROJECT BRIEF");
    expect(s).toContain("Negocio de tacos");
    expect(s).toContain("DOCUMENTO ACTUAL");
    expect(s).toContain('data-op-id="a1"');
  });
  it("omits the brief block when empty", () => {
    const s = buildAgentContext({ state: {}, taggedHtml: "<html></html>", userBrief: null });
    expect(s).not.toContain("PROJECT BRIEF");
  });

  it("adds an attached-image block with the URL verbatim when attachedImage is set", () => {
    const s = buildAgentContext({
      state: {},
      taggedHtml: "<html></html>",
      userBrief: null,
      attachedImage: { url: "https://images.openlen.com/foo.webp", alt: "Foto de taco" },
    });
    expect(s).toContain("IMAGEN ADJUNTA");
    expect(s).toContain("https://images.openlen.com/foo.webp");
    expect(s).toContain("Foto de taco");
    expect(s).toContain("editar_pagina");
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
      taggedHtml: "<html></html>",
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
    const s = buildAgentContext({ state: {}, taggedHtml: "<html></html>", userBrief: null });
    expect(s).not.toContain("IMAGEN ADJUNTA");
  });

  // F5 — los píxeles viajan adjuntos: el bloque lo dice SOLO con visible=true.
  it("visible=true adds the PUEDES VERLA line; without it the text is the F2 shape", () => {
    const base = {
      state: {},
      taggedHtml: "<html></html>",
      userBrief: null,
    };
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

  it("adds a hard-pin focus block with the op-id and hint when scopePin is set", () => {
    const s = buildAgentContext({
      state: {},
      taggedHtml: "<html></html>",
      userBrief: null,
      scopePin: { opId: "b7", hint: "h1 > Bienvenidos" },
    });
    expect(s).toContain("b7");
    expect(s).toContain("PIN");
    expect(s).toContain("h1 > Bienvenidos");
  });

  it("adds a soft hint block when only scopeHint is set (no pin)", () => {
    const s = buildAgentContext({
      state: {},
      taggedHtml: "<html></html>",
      userBrief: null,
      scopeHint: "section:nth-of-type(2)",
    });
    expect(s).toContain("section:nth-of-type(2)");
    expect(s).not.toContain("PIN");
  });

  it("prefers scopePin over scopeHint when both are set", () => {
    const s = buildAgentContext({
      state: {},
      taggedHtml: "<html></html>",
      userBrief: null,
      scopePin: { opId: "c3", hint: "pin hint" },
      scopeHint: "should not appear as a soft hint",
    });
    expect(s).toContain("c3");
    expect(s.match(/PIN/g)?.length ?? 0).toBeGreaterThan(0);
  });

  // Ya NO es byte-idéntico a F1, y ahora por DOS razones. La primera es el
  // bloque HOY: el modelo no sabía qué día era — pidiéndole una cuenta
  // regresiva "dentro de tres semanas" escribió una fecha dos meses anterior a
  // hoy, y el contador nacía vencido.
  //
  // 🔴 La segunda (2026-09-01) es el ORDEN: el documento pasa a ir DELANTE de
  // todo, justo detrás del prompt de sistema. Estaba séptimo de doce, o sea en
  // mitad del contexto, que es la peor posición para el bloque más largo y el
  // único que el modelo tiene que leer entero para acertar con un data-op-id.
  // Y al quedar acotado por `FIN_DEL_DOCUMENTO` se vuelve PODABLE, que es lo
  // que permite dejar de reenviarlo cuando ya no vale.
  //
  // El resto del contexto sigue pinchado carácter a carácter.
  it("igual a F1 pero con el DOCUMENTO delante y el bloque HOY tras él", () => {
    const state = { publicado: true };
    const taggedHtml = `<html data-op-id="z9"></html>`;
    const userBrief = "Panadería artesanal";
    const f1 = (a: { state: Record<string, unknown>; taggedHtml: string; userBrief: string | null }) => {
      const brief = (a.userBrief ?? "").trim();
      const briefBlock = brief
        ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
        : "";
      return `DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):\n\n${a.taggedHtml}${FIN_DEL_DOCUMENTO}${HOY(new Date("2026-08-18T12:00:00Z"))}ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(a.state, null, 2)}\n\n${briefBlock}`;
    };
    const args = { state, taggedHtml, userBrief, now: new Date("2026-08-18T12:00:00Z") };
    expect(buildAgentContext(args)).toBe(f1(args));
  });

  // F4 Task 1 — multi-page base: buildAgentContext gains activePage.
  it("names the active page in ESTADO and the DOCUMENTO header when activePage is a slug", () => {
    const s = buildAgentContext({
      state: { publicado: false },
      taggedHtml: `<html data-op-id="m1"></html>`,
      userBrief: null,
      activePage: "menu",
    });
    expect(s).toContain('"pagina_activa": "menu"');
    expect(s).toMatch(/DOCUMENTO ACTUAL[^\n]*"menu"/);
  });

  // Mismo motivo que arriba: el documento delante, el bloque HOY tras él, y el
  // resto sigue pinchado carácter a carácter.
  it("igual a F3 con activePage null, con el documento delante", () => {
    const state = { publicado: true };
    const taggedHtml = `<html data-op-id="z9"></html>`;
    const userBrief = "Panadería artesanal";
    const f3 = (a: { state: Record<string, unknown>; taggedHtml: string; userBrief: string | null }) => {
      const brief = (a.userBrief ?? "").trim();
      const briefBlock = brief
        ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
        : "";
      return `DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):\n\n${a.taggedHtml}${FIN_DEL_DOCUMENTO}${HOY(new Date("2026-08-18T12:00:00Z"))}ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(a.state, null, 2)}\n\n${briefBlock}`;
    };
    const args = { state, taggedHtml, userBrief, now: new Date("2026-08-18T12:00:00Z") };
    expect(buildAgentContext({ ...args, activePage: null })).toBe(f3(args));
  });
});

describe("lo que ya se sabe roto", () => {
  const args = {
    state: {},
    taggedHtml: "<html></html>",
    userBrief: null,
    now: new Date("2026-08-22T12:00:00Z"),
  };

  // El diagnóstico existía escrito y el Agente empezaba a ciegas: quien decía
  // «los botones no funcionan» arrancaba sin lo que el sistema ya sabía.
  it("le llega el diagnóstico CONCRETO, no el código", () => {
    const s = buildAgentContext({
      ...args,
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
    const s = buildAgentContext({ ...args, degradaciones: [{ code: "scripts" }] });
    expect(s).not.toContain("LO QUE YA SE SABE ROTO");
  });

  // El invariante de este módulo: una capacidad que no se usa no cuesta un byte,
  // y la caché de prefijo no se invalida para quien nunca perdió nada.
  it("sin degradaciones el contexto sale IDÉNTICO", () => {
    expect(buildAgentContext({ ...args, degradaciones: [] })).toBe(buildAgentContext(args));
    expect(buildAgentContext({ ...args, degradaciones: undefined })).toBe(buildAgentContext(args));
  });

  it("se acota a ocho", () => {
    const muchas = Array.from({ length: 20 }, (_, i) => ({ code: "x", detail: [`fallo-${i}`] }));
    const s = buildAgentContext({ ...args, degradaciones: muchas });
    expect(s).toContain("fallo-7");
    expect(s).not.toContain("fallo-8");
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

  it("el mensaje system real de Len le ofrece el JavaScript", () => {
    const previo = process.env.OPENLEN_MODEL_JS;
    const previoDocOps = process.env.OPENLEN_DOC_OPS;
    process.env.OPENLEN_MODEL_JS = "1";
    process.env.OPENLEN_DOC_OPS = "1";
    try {
      const result = buildAgentMessages({
        state: { publicado: false },
        taggedHtml: '<html data-op-id="a1"><body></body></html>',
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
      expect(sentSystem.content).toContain("INTERACTIVIDAD — la escribes TÚ");
      expect(sentSystem.content).not.toContain("data-ol-sticky");

      const editarPagina = buildFunctionDeclarations()
        .find((declaration) => declaration.name === "editar_pagina") as { description: string };
      const inputEfectivo = `${sentSystem.content}\n${editarPagina.description}`;
      expect(editarPagina.description).not.toMatch(/conducta/i);
      expect(inputEfectivo).not.toContain("CONDUCTA (data-ol-calc y las demás)");
      for (const name of BEHAVIOR_ORDER) {
        expect(inputEfectivo, `quedó el marcador declarativo de ${name}`).not.toContain(BEHAVIORS[name].marker);
      }
      expect(editarPagina.description).toContain('target="runtime"');
      expect(editarPagina.description).toContain("MANDA TAMBIÉN `prueba`");
    } finally {
      if (previo === undefined) delete process.env.OPENLEN_MODEL_JS;
      else process.env.OPENLEN_MODEL_JS = previo;
      if (previoDocOps === undefined) delete process.env.OPENLEN_DOC_OPS;
      else process.env.OPENLEN_DOC_OPS = previoDocOps;
    }
  });
});

// ─── LA VISTA RECORTADA (hallazgo 14) ──────────────────────────────────────
//
// `buildScopedView` llevaba meses construido, probado y en soak, y su único
// llamador de producción era `ai-design` — el Chat, que es la ruta OPT-OUT. Len,
// la superficie por defecto, calculaba el pin y lo gastaba sólo como pista de
// texto: después mandaba el documento ENTERO en cada vuelta, y con el mismo
// techo de 240k que el Chat sortea recortando se estrellaba con un 413.
//
// Aquí el recorte llega ya construido (lo calcula la ruta, porque
// `buildScopedView` es el binding nativo y este módulo se mantiene libre de él).
const RECORTE = {
  scopedHtml: '<section data-op-id="s1"><h2 data-op-id="h1">Precios</h2></section>',
  containerOpId: "s1",
  outline: '- [s0] header "Inicio"\n- [s2] footer "Contacto"',
  pinIsContainer: true,
};

describe("la vista recortada", () => {
  const conDoc = {
    now: new Date("2026-09-01T12:00:00Z"),
    state: { titulo: "x", publicado: false },
    taggedHtml: '<body data-op-id="b"><section data-op-id="s0">TODO EL DOCUMENTO</section></body>',
    userBrief: null,
  };

  it("sin recorte, el documento entero — byte a byte como antes", () => {
    const out = buildAgentContext(conDoc);
    expect(out).toContain("TODO EL DOCUMENTO");
    expect(out).toContain("DOCUMENTO ACTUAL");
    // Y la ausencia del campo no puede cambiar ni un carácter.
    expect(buildAgentContext({ ...conDoc, scopedView: null })).toBe(out);
  });

  it("con recorte, va la sección y NO el documento completo", () => {
    const out = buildAgentContext({ ...conDoc, scopedView: RECORTE });
    expect(out).toContain("VISTA RECORTADA");
    expect(out).toContain("Precios");
    expect(out).toContain('data-op-id="s1"');
    // Lo que de verdad importa: el documento entero NO viaja.
    expect(out).not.toContain("TODO EL DOCUMENTO");
  });

  it("le dice que los op-id del ÍNDICE también son direccionables", () => {
    // Sin esta frase el modelo se autolimita a lo que tiene delante y deja de
    // poder insertar antes o después de una sección que no ve — las ops SÍ se
    // aplican contra el documento completo, que vive en la sesión del turno.
    const out = buildAgentContext({ ...conDoc, scopedView: RECORTE });
    expect(out).toContain("índice TAMBIÉN son direccionables");
    expect(out).toContain("s2");
  });

  it("y le dice cómo pedir el documento entero si lo necesita", () => {
    // Es la diferencia con ai-design, que es de un solo tiro: aquí recortar no
    // es una pérdida, es bajo demanda.
    const out = buildAgentContext({ ...conDoc, scopedView: RECORTE });
    expect(out).toContain("incluir_documento=true");
  });

  it("recorta de verdad: el contexto encoge con un documento grande", () => {
    const grande = { ...conDoc, taggedHtml: "<p>" + "x".repeat(200_000) + "</p>" };
    const entero = buildAgentContext(grande).length;
    const recortado = buildAgentContext({ ...grande, scopedView: RECORTE }).length;
    expect(recortado).toBeLessThan(entero / 10);
  });
});

// ─── EL REPARTO EN LA RUTA, que es donde esto se puede romper de verdad ─────
//
// El `taggedHtml` va a DOS sitios y sólo uno puede recortarse:
//   · `buildAgentMessages(...)` → lo que VE el modelo. Aquí sí.
//   · `agentSession.taggedHtml`  → contra lo que se APLICAN las ops. Aquí NO,
//     jamás: incluidas las ops dirigidas a op-ids que sólo salen en el índice.
//
// Pasarle el recorte a la sesión sería aplicar ediciones contra un fragmento y
// perder el resto del documento — en silencio, y sobre la página de un usuario.
// Es la clase de "optimización" que parece obvia seis meses después, así que
// queda clavada.
// EL PLANO B, PROBADO DE VERDAD — no sólo cableado.
//
// Las guardas de abajo leen el código fuente y comprueban que el reintento
// EXISTE. Esto comprueba que SIRVE: que la misma página que no cabe entera sí
// cabe con el índice, y que lo que llega al modelo dice claramente que sólo
// tiene el índice delante.
describe("soloIndice: el turno que antes era un 413", () => {
  const secciones = Array.from(
    { length: 400 },
    (_, i) =>
      `<section data-op-id="s${i}"><h2 data-op-id="h${i}">Seccion ${i}</h2><p data-op-id="p${i}">${"contenido ".repeat(40)}</p></section>`,
  ).join("");
  const taggedHtml = `<html data-op-id="a1"><body data-op-id="b1">${secciones}</body></html>`;
  const base = {
    state: { publicado: false },
    taggedHtml,
    userBrief: null,
    prompt: "pon los botones en azul",
    history: [],
    // Entre los dos tamaños a propósito: el documento completo son ~57k tokens
    // y el índice ~5k, sobre un prefijo fijo (prompt + herramientas) de ~13k.
    maxPromptTokens: 45_000,
  };

  it("sin indice NO cabe — que es el 413 de hoy", () => {
    expect(buildAgentMessages(base).ok).toBe(false);
  });

  it("con el indice SI cabe", () => {
    const indice = buildOutline(taggedHtml);
    expect(indice).not.toBeNull();
    expect(buildAgentMessages({ ...base, soloIndice: indice }).ok).toBe(true);
  });

  it("y el modelo sabe que solo tiene el indice, y como abrir una seccion", () => {
    const r = buildAgentMessages({ ...base, soloIndice: buildOutline(taggedHtml) });
    if (!r.ok) throw new Error("deberia caber con el indice");
    const contexto = r.messages.map((m) => m.content).join(" ");
    expect(contexto).toContain("SÓLO EL ÍNDICE");
    expect(contexto).toContain("leer_estado");
    expect(contexto).toContain("op_id");
    // Y NO se le cuela el documento entero por otro lado.
    expect(contexto).not.toContain('data-op-id="p399"');
  });
});

describe("la ruta del Agente reparta el documento como debe", () => {
  const src = readFileSync(
    path.join(process.cwd(), "app/api/agent/route.ts"),
    "utf8",
  );

  it("el extractor está leyendo la ruta de verdad", () => {
    expect(src).toContain("const scopedView = scopePin ?");
  });

  it("la sesión del turno NO recibe el recorte", () => {
    // La sesión se construye con `taggedHtml,` a secas. Si alguien le colara
    // `taggedHtml: scopedView...` o un `scopedView,` dentro, esto salta.
    const sesion = src.slice(src.indexOf("const agentSession: AgentSession = {"));
    const cuerpo = sesion.slice(0, sesion.indexOf("};"));
    expect(cuerpo).toContain("taggedHtml,");
    expect(cuerpo).not.toContain("scopedView");
    // Mismo motivo para el índice: las ops se aplican contra el documento
    // COMPLETO, y colarle el índice a la sesión sería recortarlo de verdad.
    expect(cuerpo).not.toContain("soloIndice");
    // Lo que la sesión SÍ recibe es un BOOLEANO: que este turno entró a ciegas.
    // Es lo que le dice a editar_pagina que no deje borrar ni reemplazar una
    // sección que el modelo no ha abierto (rejectBlindOps). Sin este cable la
    // guarda existe y no corre nunca — que es como nació el plano B entero.
    expect(cuerpo).toContain("entroACiegas");
  });

  it("y el contexto del modelo SÍ lo recibe", () => {
    const ctx = src.slice(src.indexOf("const argsDelTurno = {"));
    const cuerpo = ctx.slice(0, ctx.indexOf("maxPromptTokens"));
    expect(cuerpo).toContain("scopedView,");
  });

  // EL PLANO B. Sin pin y sin sitio, antes se devolvía un 413 y Len no existía
  // en esa página. Estas tres líneas vigilan que el reintento siga cableado:
  // que se calcule el índice, que se pase, y —lo que de verdad importa— que
  // ocurra ANTES de rendirse. Un reintento después del `return` no corre nunca.
  it("cuando no cabe y no hay pin, reintenta con el índice ANTES del 413", () => {
    expect(src).toContain("buildOutline(taggedHtml)");
    expect(src).toContain("soloIndice: indice");
    expect(src.indexOf("soloIndice: indice")).toBeLessThan(
      src.indexOf('errorJson(413, "Page too large'),
    );
  });

  it("el reintento sólo entra si el camino normal YA falló y no había pin", () => {
    // Un turno que hoy funciona tiene que salir byte a byte idéntico: si esta
    // condición se relajara, el índice entraría en páginas que caben enteras.
    expect(src).toContain("if (!built.ok && !scopePin) {");
  });
});
