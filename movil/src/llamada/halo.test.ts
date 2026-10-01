import { describe, expect, it } from "vitest";
import { nivelDeVoz } from "./halo";

describe("el halo late con la voz real de Len", () => {
  it("silencio (todo en 128) → 0", () => {
    expect(nivelDeVoz(new Uint8Array(64).fill(128))).toBe(0);
  });

  it("onda fuerte → cerca de 1, nunca más", () => {
    const d = new Uint8Array(64).map((_, i) => (i % 2 ? 255 : 0));
    expect(nivelDeVoz(d)).toBeGreaterThan(0.9);
    expect(nivelDeVoz(d)).toBeLessThanOrEqual(1);
  });
});
