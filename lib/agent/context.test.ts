import { describe, expect, it } from "vitest";
import { buildAgentContext, estimateContextTokens } from "./context";

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

  it("byte-identical to F1 output when no new args are passed", () => {
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
    const args = { state, taggedHtml, userBrief };
    expect(buildAgentContext(args)).toBe(f1(args));
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
