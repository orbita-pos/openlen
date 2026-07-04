import { describe, expect, it } from "vitest";
import { HASHTAGS, fillCaption, listCaptions } from "./captions";
import { POST_GOALS, POST_REGISTERS } from "./post-templates/families";

describe("captions registry", () => {
  it("every register×goal×lang resolves to ≥1 formula (general fallback)", () => {
    for (const r of POST_REGISTERS) for (const g of POST_GOALS) for (const lang of ["es", "en"] as const) {
      expect(listCaptions(r, g, lang).length).toBeGreaterThan(0);
    }
  });
  it("fillCaption resolves every token and drops parts with missing needs", () => {
    const [f] = listCaptions("general", "promo", "es");
    const full = fillCaption(f, { businessName: "Brote", offer: "Ramos 2x1", url: "brote.openlen.com" });
    expect(full).not.toMatch(/\{[a-zA-Z]+\}/);
    const partial = fillCaption(f, { businessName: "Brote" });
    expect(partial).not.toMatch(/\{[a-zA-Z]+\}/); // parts needing offer/url dropped, not left broken
  });
  it("every part of every formula declares its tokens in needs and stays within limits", () => {
    for (const r of POST_REGISTERS) for (const g of POST_GOALS) for (const lang of ["es", "en"] as const) {
      for (const f of listCaptions(r, g, lang)) {
        for (const p of f.parts) {
          const tokens = [...p.text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
          for (const tk of tokens) {
            expect(p.needs ?? [], `${f.register}·${f.goal}·${f.lang}: "{${tk}}" sin needs`).toContain(tk);
          }
          expect(p.text.length, `${f.register}·${f.goal}·${f.lang}: parte >120 chars`).toBeLessThanOrEqual(120);
        }
      }
    }
  });
  it("vertical registers now resolve to their own formulas, not the general fallback", () => {
    for (const r of POST_REGISTERS.filter((x) => x !== "general")) {
      for (const g of POST_GOALS) for (const lang of ["es", "en"] as const) {
        const fs = listCaptions(r, g, lang);
        expect(fs.length).toBe(3);
        expect(fs.every((f) => f.register === r)).toBe(true);
      }
    }
  });
  it("appends language-matched hashtags", () => {
    const [es] = listCaptions("general", "promo", "es");
    const esOut = fillCaption(es, { businessName: "X" });
    expect(esOut).toMatch(/#\w+/);
    expect(esOut).toMatch(/#negociolocal|#apoyalocal/);
    const [en] = listCaptions("general", "promo", "en");
    expect(fillCaption(en, { businessName: "X" })).toMatch(/#shoplocal|#smallbusiness/);
  });
});
