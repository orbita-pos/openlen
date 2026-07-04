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
  it("appends hashtags", () => {
    const [f] = listCaptions("general", "promo", "es");
    expect(fillCaption(f, { businessName: "X" })).toMatch(/#\w+/);
  });
});
