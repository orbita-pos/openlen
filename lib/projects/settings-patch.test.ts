import { describe, expect, it } from "vitest";
import { applySettingsPatch, validateSettingsPatch } from "./settings-patch";
import type { ProjectData } from "./types";

const baseData = (): ProjectData => ({
  html: "<!doctype html><html><head><title>Tacos</title></head><body><h1>Tacos</h1></body></html>",
});

describe("validateSettingsPatch", () => {
  it("rejects a non-object body", () => {
    const v = validateSettingsPatch(null, "p1");
    expect(v.ok).toBe(false);
  });
  it("rejects a non-object body with NO message (route contract: bare invalid_body)", () => {
    for (const raw of [null, "nope", 42]) {
      const v = validateSettingsPatch(raw, "p1");
      expect(v.ok).toBe(false);
      if (v.ok) throw new Error("unreachable");
      expect(v.message).toBeUndefined();
    }
  });
  it("rejects an empty patch (no known keys)", () => {
    const v = validateSettingsPatch({}, "p1");
    expect(v.ok).toBe(false);
  });
  // Esta prueba ha ido cambiando de módulo cada vez que retiramos uno: primero
  // `members` (2026-08-21), luego `collections` (2026-08-29). Lo que de verdad
  // vigila —que un parche de módulo VÁLIDO pase— se ancla ahora en `chat`, que
  // es el único que queda.
  it("accepts a chat enable", () => {
    const v = validateSettingsPatch({ chat: { enabled: true } }, "p1");
    expect(v.ok).toBe(true);
  });
  it("rejects bad motion value", () => {
    const v = validateSettingsPatch({ motion: "frenetic" }, "p1");
    expect(v.ok).toBe(false);
  });
  // INVERTIDA el 2026-08-29: exigía que el PATCH aceptara `collections`. Ahora
  // exige que NO — un parche de un módulo retirado no puede pasar en silencio y
  // escribir un ajuste que nadie lee.
  it("ya NO acepta un parche de collections", () => {
    expect(validateSettingsPatch({ collections: { enabled: true } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ collections: { theme: "dark" } }, "p1").ok).toBe(false);
  });
});

describe("applySettingsPatch", () => {
  it("flags chatJustEnabled only on the OFF→ON edge", () => {
    const on = applySettingsPatch(baseData(), { chat: { enabled: true } });
    if ("error" in on) throw new Error(on.error);
    expect(on.chatJustEnabled).toBe(true);
    const already = applySettingsPatch(
      { ...baseData(), settings: { chat: { enabled: true } } },
      { chat: { enabled: true } },
    );
    if ("error" in already) throw new Error(already.error);
    expect(already.chatJustEnabled).toBe(false);
  });
});
