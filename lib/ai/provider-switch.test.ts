import { describe, expect, it } from "vitest";

import { writerForTurn } from "./provider-switch";

// Aquí vivían once casos sobre `usesDeepSeek` / `usesDeepSeekForTurn` y los tres
// interruptores `OPENLEN_*_PROVIDER`: que la ausencia significaba DeepSeek, que
// sólo el literal `gemini` volvía atrás, que los tres eran independientes.
//
// Salieron con el proveedor el 2026-08-28. Lo que queda es la única pregunta
// que todavía tiene dos respuestas, y su brazo de control: al razonador nunca
// se le manda una imagen.
describe("quién escribe el turno", () => {
  it("sin imágenes escribe el razonador", () => {
    expect(writerForTurn(false)).toBe("deepseek");
  });

  it("con imágenes escribe Qwen — el razonador no tiene ojos", () => {
    expect(writerForTurn(true)).toBe("qwen");
  });

  // LA LÁPIDA DE LOS INTERRUPTORES. `writerForTurn` ya no recibe entorno, así
  // que ninguna variable puede desviar el turno.
  //
  // Se comprueba por COMPORTAMIENTO. La hermana de esta prueba lo intentó por
  // aridad (`fn.length`) y salió roja por un motivo que no era el suyo: un
  // parámetro con valor por defecto no cuenta. Poner el valor que ANTES
  // desviaba el turno y ver que no cambia nada es lo que hay que demostrar.
  it.each([["gemini"], ["GEMINI"], ["  Gemini  "]])(
    "OPENLEN_CHAT_PROVIDER=%p no desvía nada",
    (value) => {
      const previo = process.env.OPENLEN_CHAT_PROVIDER;
      process.env.OPENLEN_CHAT_PROVIDER = value;
      try {
        expect(writerForTurn(false)).toBe("deepseek");
        expect(writerForTurn(true)).toBe("qwen");
      } finally {
        if (previo === undefined) delete process.env.OPENLEN_CHAT_PROVIDER;
        else process.env.OPENLEN_CHAT_PROVIDER = previo;
      }
    },
  );
});
