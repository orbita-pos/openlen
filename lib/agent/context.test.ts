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
