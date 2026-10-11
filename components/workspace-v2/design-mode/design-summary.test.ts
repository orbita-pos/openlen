// El mensaje que deja «Aplicar» en el chat, con los textos de verdad: el plural
// de «elemento» tiene que salir bien (salía «1 elementos»).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { designSummary } from "./design-edits";

const ELEMENTO = {
  chain: [{ path: "/src/App.tsx", line: 7, component: null }],
  primary: 0,
  tag: "h1",
  text: "Hola",
  copies: 1,
  screen: "#/",
  changes: [{ property: "font-size" as const, before: "32px", after: "48px" }],
};
const traductor = (locale: string) => {
  const messages = JSON.parse(readFileSync(`messages/${locale}/panelsProps.json`, "utf8"));
  return createTranslator({ locale, messages, namespace: undefined }) as unknown as (k: string, v?: Record<string, string | number>) => string;
};

describe("el resumen de «Aplicar» en el chat", () => {
  it("🔴 un elemento en singular y varios en plural (es)", () => {
    const t = traductor("es");
    expect(designSummary({ elements: [ELEMENTO] }, t).split("\n")[0]).toBe("Cambios de diseño · 1 elemento");
    expect(designSummary({ elements: [ELEMENTO, ELEMENTO] }, t).split("\n")[0]).toBe("Cambios de diseño · 2 elementos");
  });
  it("y en inglés", () => {
    expect(designSummary({ elements: [ELEMENTO] }, traductor("en")).split("\n")[0]).toBe("Design changes · 1 element");
  });
  it("cada elemento con sus cambios, y la nota general al final", () => {
    const r = designSummary({ elements: [ELEMENTO], note: "más aire" }, traductor("es")).split("\n");
    expect(r[1]).toBe("- <h1> «Hola»: Tamaño 32px → 48px");
    expect(r[2]).toBe("más aire");
  });
});
