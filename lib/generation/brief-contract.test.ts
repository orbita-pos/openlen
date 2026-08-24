import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GENERATION_BRIEF_MAX_LENGTH,
  applyGenerationBriefPaste,
  isGenerationBriefLengthValid,
  prepareGenerationBriefInput,
  shouldSyncGenerationBriefParam,
  shouldShowGenerationBriefCounter,
} from "./brief-contract";

describe("contrato compartido del brief de generación", () => {
  it("calcula la capacidad de un pegado descontando la selección", () => {
    const current = `${"a".repeat(3998)}YZ`;

    const result = applyGenerationBriefPaste({
      value: current,
      selectionStart: 3998,
      selectionEnd: 4000,
      pastedText: "123",
    });

    expect(result).toEqual({
      value: `${"a".repeat(3998)}12`,
      caret: 4000,
      truncated: true,
    });
  });

  it("acepta briefs normales de 3000 caracteres y conserva las fronteras", () => {
    expect(isGenerationBriefLengthValid("x".repeat(9))).toBe(false);
    expect(isGenerationBriefLengthValid("x".repeat(10))).toBe(true);
    expect(isGenerationBriefLengthValid("x".repeat(3000))).toBe(true);
    expect(isGenerationBriefLengthValid("x".repeat(4000))).toBe(true);
    expect(isGenerationBriefLengthValid("x".repeat(4001))).toBe(false);
  });

  it("muestra el contador sólo al superar 75% del máximo", () => {
    expect(shouldShowGenerationBriefCounter(3000)).toBe(false);
    expect(shouldShowGenerationBriefCounter(3001)).toBe(true);
  });

  it("acota un deep-link externo, lo marca y no permite su autostart", () => {
    const prepared = prepareGenerationBriefInput(`  ${"x".repeat(4001)}  `);

    expect(prepared.value).toHaveLength(GENERATION_BRIEF_MAX_LENGTH);
    expect(prepared.truncated).toBe(true);
    expect(prepared.autostartAllowed).toBe(false);
  });

  it("no parte un emoji al acotar un deep-link", () => {
    const prepared = prepareGenerationBriefInput(`${"x".repeat(3999)}😀`);

    expect(prepared.value).toBe("x".repeat(3999));
    expect(prepared.truncated).toBe(true);
    expect(() => encodeURIComponent(prepared.value)).not.toThrow();
  });

  it("no pega medio emoji cuando sólo queda una unidad UTF-16", () => {
    const result = applyGenerationBriefPaste({
      value: "x".repeat(3999),
      selectionStart: 3999,
      selectionEnd: 3999,
      pastedText: "😀",
    });

    expect(result.value).toBe("x".repeat(3999));
    expect(result.caret).toBe(3999);
    expect(result.truncated).toBe(true);
    expect(() => encodeURIComponent(result.value)).not.toThrow();
  });

  it("permite autostart únicamente cuando el deep-link ya cumple el contrato", () => {
    expect(prepareGenerationBriefInput("  un brief suficientemente largo  ")).toEqual({
      value: "un brief suficientemente largo",
      truncated: false,
      autostartAllowed: true,
    });
    expect(prepareGenerationBriefInput("corto").autostartAllowed).toBe(false);
  });

  it("sincroniza nuevos deep-links pero no borra por navegación interna ni por su propia normalización", () => {
    expect(
      shouldSyncGenerationBriefParam("brief anterior", "brief nuevo", undefined),
    ).toBe(true);
    expect(
      shouldSyncGenerationBriefParam("brief anterior", null, undefined),
    ).toBe(false);
    expect(
      shouldSyncGenerationBriefParam(
        "x".repeat(4001),
        "x".repeat(4000),
        "x".repeat(4000),
      ),
    ).toBe(false);
  });
});

describe("traducciones de la advertencia", () => {
  const locales = ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"];

  for (const locale of locales) {
    it(`carga messages/${locale}/panelsA.json`, () => {
      const path = join(process.cwd(), "messages", locale, "panelsA.json");
      const messages = JSON.parse(readFileSync(path, "utf8")) as {
        aiBrief?: { trimmed?: unknown };
      };

      expect(messages.aiBrief?.trimmed).toEqual(expect.any(String));
      expect(messages.aiBrief?.trimmed).toContain("{max}");
    });
  }
});
