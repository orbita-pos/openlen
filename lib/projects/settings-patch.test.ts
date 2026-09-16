import { describe, expect, it } from "vitest";
import { applySettingsPatch, validateSettingsPatch } from "./settings-patch";
import type { SettingsPatchBody } from "./settings-patch";
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

// ─────────────────────────────────────────────────────────────────────────────
// EL OBJETIVO PASABA LA MITAD DE LA PUERTA.
//
// `applySettingsPatch` sabía poner y borrar `objetivo` desde el primer día, pero
// `validateSettingsPatch` —que corre ANTES y decide si la petición sigue— no lo
// tenía en su lista blanca. Así que TODA escritura del objetivo salía 400 sin
// llegar nunca al que sabía aplicarla: la tarjeta de aprobación de Len nunca
// funcionó, y la ficha de cancelar habría nacido muerta.
//
// Es la misma decisión —«qué claves acepto»— escrita en dos sitios, con una
// quedándose atrás. Tercera vez esta semana. Medido el 2026-09-08 contra el dev
// real: PATCH {objetivo:{condicion}} → 400.
// ─────────────────────────────────────────────────────────────────────────────
describe("el objetivo cruza el validador", () => {
  it("acepta ponerlo", () => {
    const v = validateSettingsPatch({ objetivo: { condicion: "el pie lleva mi teléfono" } }, "p1");
    expect(v.ok).toBe(true);
  });

  it("acepta BORRARLO con null — así lo cancela el dueño", () => {
    expect(validateSettingsPatch({ objetivo: null }, "p1").ok).toBe(true);
  });

  it("y lo aplicado coincide: entra, y el null lo saca", () => {
    const puesto = applySettingsPatch(baseData(), {
      objetivo: { condicion: "el pie lleva mi teléfono" },
    });
    if ("error" in puesto) throw new Error(puesto.error);
    expect(puesto.settings.objetivo?.condicion).toBe("el pie lleva mi teléfono");

    const quitado = applySettingsPatch(
      { ...baseData(), settings: puesto.settings },
      { objetivo: null },
    );
    if ("error" in quitado) throw new Error(quitado.error);
    expect(quitado.settings.objetivo).toBeUndefined();
  });

  it("una condición que no es texto no pasa", () => {
    expect(validateSettingsPatch({ objetivo: { condicion: 42 } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ objetivo: {} }, "p1").ok).toBe(false);
  });

  // 🔴 BRAZO DE CONTROL: la puerta sigue cerrada para lo que no nombra nadie.
  // Sin esto, «añadir objetivo a la lista» podría abrirla del todo por accidente.
  it("un cuerpo sin ninguna clave conocida SIGUE rechazado", () => {
    expect(validateSettingsPatch({ loQueSea: 1 }, "p1").ok).toBe(false);
  });
});

describe("assistant en el embudo", () => {
  it("🔴 valida y funde los tres campos", () => {
    const v = validateSettingsPatch(
      { assistant: { enabled: true, facts: "Abrimos de 9 a 18", tone: "cálido" } },
      "p1",
    );
    expect(v.ok, "message" in v ? v.message : "").toBe(true);
    const out = applySettingsPatch(
      { html: "", settings: {} } as never,
      (v as { body: SettingsPatchBody }).body,
    );
    // Narrowing: applySettingsPatch devuelve una unión con `{ error: string }`
    // (misma convención que el resto de este fichero, ver "el objetivo...").
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.assistant).toEqual({
      enabled: true,
      facts: "Abrimos de 9 a 18",
      tone: "cálido",
    });
  });

  it("🔴 LAS DOS MITADES ATADAS: lo que el validador acepta, el aplicador lo funde", () => {
    // La avería del `objetivo`: el aplicador sabía, el validador no, y todo
    // salía 400. Esta prueba es lo que impide repetirla.
    const v = validateSettingsPatch({ assistant: { enabled: true } }, "p1");
    expect(v.ok).toBe(true);
    const out = applySettingsPatch(
      { html: "", settings: { assistant: { facts: "previo" } } } as never,
      (v as { body: SettingsPatchBody }).body,
    );
    if ("error" in out) throw new Error(out.error);
    // Funde, NO reemplaza: `facts` sobrevive a un patch que sólo trae enabled.
    expect(out.settings.assistant).toEqual({ enabled: true, facts: "previo" });
  });

  it("rechaza tipos malos", () => {
    expect(validateSettingsPatch({ assistant: { enabled: "sí" } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ assistant: { facts: 42 } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ assistant: null }, "p1").ok).toBe(false);
  });

  it("BRAZO DE CONTROL: un cuerpo vacío sigue sin ser parcheable", () => {
    // Si `assistant` entrara en la guarda de «nada que parchear» de forma
    // chapucera, un `{}` pasaría a ser válido y toda petición vacía escribiría.
    expect(validateSettingsPatch({}, "p1").ok).toBe(false);
  });

  it("recorta `facts` al tope, al ESCRIBIR y no al consumir", () => {
    const v = validateSettingsPatch({ assistant: { facts: "x".repeat(5000) } }, "p1");
    expect(v.ok).toBe(true);
    const out = applySettingsPatch(
      { html: "", settings: {} } as never,
      (v as { body: SettingsPatchBody }).body,
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.assistant?.facts?.length).toBe(4000);
  });
});
