import { describe, it, expect } from "vitest";
import { normalizeHandle, validateHandle } from "./handle";

describe("normalizeHandle", () => {
  it("lowercases and strips a leading @", () => {
    expect(normalizeHandle("@Jesus")).toBe("jesus");
    expect(normalizeHandle("  ADuk_9 ")).toBe("aduk_9");
  });
});

describe("validateHandle", () => {
  it("accepts a valid slug", () => {
    expect(validateHandle("jesus_99")).toEqual({ ok: true, handle: "jesus_99" });
  });
  it("rejects too short / too long", () => {
    expect(validateHandle("ab").ok).toBe(false);
    expect(validateHandle("a".repeat(21)).ok).toBe(false);
  });
  it("reserves «assistant»: the person's own assistant lives at /<locale>/assistant/<name>", () => {
    expect(validateHandle("assistant")).toEqual({ ok: false, reason: "reserved" });
  });
  it("rejects illegal characters", () => {
    expect(validateHandle("hey.there").ok).toBe(false);
    expect(validateHandle("con espacio").ok).toBe(false);
  });
  it("rejects reserved words", () => {
    expect(validateHandle("explore").ok).toBe(false);
    expect(validateHandle("admin").ok).toBe(false);
    expect(validateHandle("new").ok).toBe(false);
  });
  // /features and /pricing are pages since 06/11 (spec local 2026-11-06-portada-solo-input): a profile with that name
  // would be hidden behind them.
  it("🔴 rejects the names of the new marketing pages", () => {
    expect(validateHandle("features")).toEqual({ ok: false, reason: "reserved" });
    expect(validateHandle("pricing")).toEqual({ ok: false, reason: "reserved" });
  });
});
