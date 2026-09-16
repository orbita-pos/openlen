// QUIÉN LE CONTESTA A LA GENTE QUE ENTRA EN TU PÁGINA.
//
// Ésa es la pregunta que el 2026-09-16 ninguna superficie contestaba, y contra
// la que se juzga esta funcionalidad. La tabla de abajo ES el diseño.
import { describe, expect, it } from "vitest";
import { estadoDeLaBurbuja } from "./estado-de-la-burbuja";

describe("estadoDeLaBurbuja", () => {
  const casos = [
    { asistente: false, chat: false, publicada: true, esperado: "nadie" },
    { asistente: true, chat: false, publicada: true, esperado: "soloIA" },
    { asistente: false, chat: true, publicada: true, esperado: "soloTu" },
    { asistente: true, chat: true, publicada: true, esperado: "ambos" },
    // 🔴 EL QUINTO ESTADO, y sin él la franja MIENTE: sin publicar, la burbuja
    // no existe todavía para nadie.
    { asistente: true, chat: true, publicada: false, esperado: "ambosSinPublicar" },
    { asistente: false, chat: false, publicada: false, esperado: "nadieSinPublicar" },
  ] as const;

  for (const c of casos) {
    it(`asistente=${c.asistente} chat=${c.chat} publicada=${c.publicada} → ${c.esperado}`, () => {
      expect(estadoDeLaBurbuja(c)).toBe(c.esperado);
    });
  }

  it("BRAZO DE CONTROL: publicar CAMBIA la respuesta", () => {
    // Si `publicada` se ignorara, todas las filas de arriba pasarían igual y la
    // franja diría que funciona algo que nadie puede ver.
    expect(estadoDeLaBurbuja({ asistente: true, chat: true, publicada: true })).not.toBe(
      estadoDeLaBurbuja({ asistente: true, chat: true, publicada: false }),
    );
  });
});
