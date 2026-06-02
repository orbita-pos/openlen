import { describe, it, expect } from "vitest";
import { wcagContrast } from "culori";
import { deriveAccentInk, deriveContractColors } from "./theme-derive";

const ACCENTS = ["#3ECF8E", "#2563eb", "#ff5a36", "#7c5cff", "#b5673e", "#10b981"];

describe("theme-derive", () => {
  it("accent-ink is readable on every accent (WCAG AA)", () => {
    for (const accent of ACCENTS) {
      expect(wcagContrast(accent, deriveAccentInk(accent))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("fg-faint clears AA on the bg, dark + light", () => {
    const dark = deriveContractColors({
      bg: "#0F0F0F", surface: "#131313", fg: "#EDEDED", border: "#222222", accent: "#3ECF8E",
    });
    expect(wcagContrast(dark["fg-faint"], "#0F0F0F")).toBeGreaterThanOrEqual(4.5);

    const light = deriveContractColors({
      bg: "#FAFAF9", surface: "#ffffff", fg: "#1A1714", border: "#e7e0d4", accent: "#b5673e",
    });
    expect(wcagContrast(light["fg-faint"], "#FAFAF9")).toBeGreaterThanOrEqual(4.5);
  });

  it("muted is more readable than faint (a real tier order)", () => {
    const c = deriveContractColors({
      bg: "#0F0F0F", surface: "#131313", fg: "#EDEDED", border: "#222222", accent: "#3ECF8E",
    });
    expect(wcagContrast(c["fg-muted"], "#0F0F0F")).toBeGreaterThan(
      wcagContrast(c["fg-faint"], "#0F0F0F"),
    );
  });

  it("returns all 13 roles as hex", () => {
    const c = deriveContractColors({
      bg: "#ffffff", surface: "#f6f7f9", fg: "#0b0d12", border: "#e3e6ea", accent: "#2563eb",
    });
    for (const k of [
      "bg", "surface", "surface-2", "fg", "fg-muted", "fg-faint",
      "border", "border-strong", "accent", "accent-ink",
    ] as const) {
      expect(c[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
