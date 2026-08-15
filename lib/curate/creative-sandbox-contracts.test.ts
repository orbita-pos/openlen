import { describe, expect, it } from "vitest";

import { parseCreativePatch } from "./creative-sandbox-contracts";

const REPLACE = { op: "replace_section", targetId: "ol-hero-1", html: "<section>hi</section>" };

describe("creative patch contract", () => {
  it("accepts every documented operation", () => {
    const result = parseCreativePatch({
      operations: [
        REPLACE,
        { op: "insert_section", afterTargetId: "ol-hero-1", role: "gallery", html: "<section>g</section>", css: ".g{gap:1rem}" },
        { op: "remove_section", targetId: "ol-features-2" },
        { op: "move_section", targetId: "ol-features-2", afterTargetId: null },
        { op: "set_page_css", css: ":root{--x:1}" },
        { op: "set_link", targetId: "ol-cta-1", url: "https://example.com", label: "Ir" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("ignores unknown explanatory fields the model likes to add", () => {
    const result = parseCreativePatch({ operations: [REPLACE], rationale: "warmer hero", confidence: 0.8 });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown operation kind", () => {
    expect(parseCreativePatch({ operations: [{ op: "replace", targetId: "ol-hero-1", html: "<section/>" }] }).ok).toBe(false);
  });

  it("rejects an operation missing a load-bearing field", () => {
    expect(parseCreativePatch({ operations: [{ op: "replace_section", targetId: "ol-hero-1" }] }).ok).toBe(false);
    expect(parseCreativePatch({ operations: [{ op: "set_link", targetId: "ol-cta-1" }] }).ok).toBe(false);
  });

  it("rejects target ids OpenLen never handed out", () => {
    expect(parseCreativePatch({ operations: [{ ...REPLACE, targetId: "hero" }] }).ok).toBe(false);
    expect(parseCreativePatch({ operations: [{ ...REPLACE, targetId: "ol-hero-1; drop" }] }).ok).toBe(false);
  });

  it("rejects an empty or oversized batch", () => {
    expect(parseCreativePatch({ operations: [] }).ok).toBe(false);
    expect(parseCreativePatch({ operations: Array.from({ length: 13 }, () => REPLACE) }).ok).toBe(false);
  });

  it("rejects a section body beyond the byte bound", () => {
    expect(parseCreativePatch({ operations: [{ ...REPLACE, html: "x".repeat(120_001) }] }).ok).toBe(false);
  });
});
