import { describe, expect, it } from "vitest";
import { motivoDelFallo, TOPE_MOTIVO } from "./motivo-del-fallo";

describe("motivoDelFallo", () => {
  it("🔴 saca el motivo de una respuesta fallida", () => {
    expect(motivoDelFallo({ ok: false, error: "módulo desconocido" })).toBe(
      "módulo desconocido",
    );
  });

  // Las herramientas no se pusieron de acuerdo en el nombre de la clave, y
  // exigirlo ahora sería cambiar 27 ficheros para que la tarjeta hable.
  it("acepta las tres claves que las herramientas usan de verdad", () => {
    expect(motivoDelFallo({ ok: false, motivo: "llena" })).toBe("llena");
    expect(motivoDelFallo({ ok: false, reason: "no_guardado" })).toBe("no_guardado");
  });

  it("`error` gana cuando vienen varias", () => {
    expect(motivoDelFallo({ ok: false, error: "el bueno", reason: "el otro" })).toBe(
      "el bueno",
    );
  });

  // CONTRA-PRUEBA: lo que salió bien no tiene motivo que contar, y una tarjeta
  // verde con un motivo pegado sería peor que no tener motivo.
  it("CONTRA-PRUEBA: una respuesta que fue bien no da motivo", () => {
    expect(motivoDelFallo({ ok: true, error: "no es un fallo" })).toBeUndefined();
    expect(motivoDelFallo({ error: "sin ok no se juzga" })).toBeUndefined();
  });

  it("un motivo vacío o que no es texto no cuenta", () => {
    expect(motivoDelFallo({ ok: false, error: "   " })).toBeUndefined();
    expect(motivoDelFallo({ ok: false, error: 42 })).toBeUndefined();
    expect(motivoDelFallo({ ok: false })).toBeUndefined();
    expect(motivoDelFallo(undefined)).toBeUndefined();
  });

  // Se corta CON MARCA, nunca en silencio: Claude Code escribe
  // `... [N characters truncated] ...` en vez de dejar la frase a medias sin
  // avisar. Aquí basta el puntito, porque el motivo entero vive en el diario.
  it("corta con marca y no en silencio", () => {
    const largo = "x".repeat(TOPE_MOTIVO + 50);
    const cortado = motivoDelFallo({ ok: false, error: largo })!;
    expect(cortado).toHaveLength(TOPE_MOTIVO + 1);
    expect(cortado.endsWith("…")).toBe(true);
  });
});
