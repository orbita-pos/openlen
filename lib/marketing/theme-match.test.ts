import { describe, expect, it } from "vitest";
import {
  derivePalette,
  extractPageFont,
  matchAccent,
  normHex,
  relLuminance,
} from "./theme-match";

const contrast = (a: string, b: string) => {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("matchAccent", () => {
  it("makes a muddy brand color POP on a dark bg (the ORBITAPOS case)", () => {
    // #3E6C86 steel-blue on near-black had ~3:1 and read as mud.
    const out = matchAccent("#3E6C86", "#141210");
    expect(contrast(out, "#141210")).toBeGreaterThan(4.5);
    // hue preserved (still blue): B channel dominant
    const [r, , b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });
  it("goes DEEP for a light bg instead of light", () => {
    const out = matchAccent("#3E6C86", "#f5f5f5");
    expect(contrast(out, "#f5f5f5")).toBeGreaterThan(4);
    expect(relLuminance(out)).toBeLessThan(relLuminance("#f5f5f5"));
  });
});

describe("derivePalette", () => {
  it("dark page → dark post, all three tokens legible together", () => {
    const p = derivePalette("#3E6C86", "#111111");
    expect(relLuminance(p.bg)).toBeLessThan(0.1);
    expect(contrast(p.ink, p.bg)).toBeGreaterThan(7); // body text crisp
    expect(contrast(p.accent, p.bg)).toBeGreaterThan(4.5);
  });
  it("light page → light post, all three tokens legible together", () => {
    const p = derivePalette("#C0392B", "#FBF7EF");
    expect(relLuminance(p.bg)).toBeGreaterThan(0.85);
    expect(contrast(p.ink, p.bg)).toBeGreaterThan(7);
    expect(contrast(p.accent, p.bg)).toBeGreaterThan(4.5);
  });
  it("no page bg → assumes dark", () => {
    expect(relLuminance(derivePalette("#3E6C86", null).bg)).toBeLessThan(0.1);
  });
});

describe("extractPageFont", () => {
  it("reads the --display token and builds a heavy-weight GF href", () => {
    const f = extractPageFont(`<style>:root{--display:'Poppins',sans-serif}</style>`);
    expect(f?.family).toBe("Poppins");
    expect(f?.href).toContain("family=Poppins:wght@400;600;700;800;900");
  });
  it("falls back to the first Google-Fonts family", () => {
    const f = extractPageFont(`<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@700&display=swap">`);
    expect(f?.family).toBe("Work Sans");
    expect(f?.href).toContain("family=Work+Sans:");
  });
  it("GUARDRAIL: keeps the curated font for poster-unsuitable families", () => {
    expect(extractPageFont(`<style>:root{--display:'Dancing Script',cursive}</style>`)).toBeNull();
    expect(extractPageFont(`<style>:root{--display:'JetBrains Mono',monospace}</style>`)).toBeNull();
  });
  it("returns null when the page declares no font", () => {
    expect(extractPageFont(`<html><body><h1>hi</h1></body></html>`)).toBeNull();
  });
});

describe("normHex", () => {
  it("accepts 3/6/8-digit hex, rejects junk", () => {
    expect(normHex("#abc")).toBe("#abc");
    expect(normHex("#AA3311")).toBe("#AA3311");
    expect(normHex("#AA3311ff")).toBe("#AA3311");
    expect(normHex("javascript:alert(1)")).toBeNull();
    expect(normHex(null)).toBeNull();
  });
});
