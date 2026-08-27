import { describe, expect, it } from "vitest";
import { buildAgentContext, buildAgentMessages, estimateContextTokens } from "./context";
import { buildFunctionDeclarations } from "./catalog";
import { BEHAVIOR_ORDER, BEHAVIORS } from "@/lib/behaviors/registry";
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

  // Ya NO es byte-idéntico a F1: delante va el bloque HOY. Se añadió porque el
  // modelo no sabía qué día era — pidiéndole una cuenta regresiva "dentro de
  // tres semanas" escribió una fecha dos meses anterior a hoy, y el contador
  // nacía vencido. El resto del contexto sigue pinchado carácter a carácter.
  it("igual a F1 salvo el bloque HOY que va delante", () => {
    const state = { publicado: true };
    const taggedHtml = `<html data-op-id="z9"></html>`;
    const userBrief = "Panadería artesanal";
    const f1 = (a: { state: Record<string, unknown>; taggedHtml: string; userBrief: string | null }) => {
      const brief = (a.userBrief ?? "").trim();
      const briefBlock = brief
        ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
        : "";
      return `ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(a.state, null, 2)}\n\n${briefBlock}DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):\n\n${a.taggedHtml}`;
    };
    const args = { state, taggedHtml, userBrief, now: new Date("2026-08-18T12:00:00Z") };
    expect(buildAgentContext(args)).toBe(HOY(args.now!) +f1(args));
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

  // Mismo motivo que arriba: el bloque HOY va delante, el resto sigue pinchado.
  it("igual a F3 con activePage null, salvo el bloque HOY", () => {
    const state = { publicado: true };
    const taggedHtml = `<html data-op-id="z9"></html>`;
    const userBrief = "Panadería artesanal";
    const f3 = (a: { state: Record<string, unknown>; taggedHtml: string; userBrief: string | null }) => {
      const brief = (a.userBrief ?? "").trim();
      const briefBlock = brief
        ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
        : "";
      return `ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(a.state, null, 2)}\n\n${briefBlock}DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):\n\n${a.taggedHtml}`;
    };
    const args = { state, taggedHtml, userBrief, now: new Date("2026-08-18T12:00:00Z") };
    expect(buildAgentContext({ ...args, activePage: null })).toBe(HOY(args.now!) +f3(args));
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
