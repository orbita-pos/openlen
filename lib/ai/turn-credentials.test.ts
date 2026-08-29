import { describe, expect, it } from "vitest";
import { credencialDelTurno, faltaCredencial } from "./turn-credentials";
import { writerForTurn } from "./provider-switch";

/** Sólo Fireworks configurado: la caja de Jesús el día que el prepago de Gemini
 *  se agotó. Antes de esta puerta, eso devolvía 500 en las tres superficies. */
const SOLO_FIREWORKS = { FIREWORKS_API_KEY: "fw-real" } as const;

// Aquí había cuatro bloques `it.each(CONMUTADORES)` que recorrían los tres
// interruptores `OPENLEN_*_PROVIDER`, incluido un brazo de control que exigía
// que `=gemini` pidiera `GEMINI_API_KEY`. Los interruptores salieron con el
// proveedor el 2026-08-28, y con ellos la mitad de estas pruebas.
//
// Lo que NO sale es la puerta: comprobar la credencial ANTES de abrir el stream
// es lo que arreglaba el defecto original, y eso no depende de cuántos
// proveedores haya.
describe("credencialDelTurno", () => {
  it("corre con sólo FIREWORKS_API_KEY", () => {
    const c = credencialDelTurno(SOLO_FIREWORKS);

    expect(c.writer).toBe("deepseek");
    expect(c.variable).toBe("FIREWORKS_API_KEY");
    expect(faltaCredencial(c)).toBeNull();
  });

  // El agujero por el otro lado: la puerta miraba Gemini, pasaba, y el fallo de
  // Fireworks salía a mitad del stream como `missing_key` — con el usuario ya
  // mirando la página nacer.
  it("sin FIREWORKS_API_KEY falla EN LA PUERTA, no a mitad del stream", () => {
    const c = credencialDelTurno({});

    expect(c.variable).toBe("FIREWORKS_API_KEY");
    expect(faltaCredencial(c)).toContain("FIREWORKS_API_KEY");
  });

  it("el mensaje nombra la variable que falta, no un modelo cualquiera", () => {
    const c = credencialDelTurno({});

    expect(faltaCredencial(c)).toBe(
      "DeepSeek (Fireworks) API key missing — falta FIREWORKS_API_KEY",
    );
  });

  it("una key en blanco cuenta como ausente", () => {
    const c = credencialDelTurno({ FIREWORKS_API_KEY: "   " });

    expect(c.key).toBeUndefined();
    expect(faltaCredencial(c)).not.toBeNull();
  });

  // Y el turno con imagen nombra a QWEN en el mensaje, aunque pida la misma
  // credencial: quien opera la caja lee la etiqueta, y decirle «DeepSeek» sobre
  // un turno que corrió Qwen manda a buscar el fallo donde no está.
  it("con imagen la etiqueta dice Qwen", () => {
    expect(credencialDelTurno({}, true).label).toBe("Qwen (Fireworks)");
    expect(credencialDelTurno({}, false).label).toBe("DeepSeek (Fireworks)");
  });
});

/**
 * LA SUPOSICIÓN QUE HACE SEGURO NO MIRAR LAS IMÁGENES.
 *
 * La puerta corre antes de saber si el turno lleva imágenes, y eso sólo vale
 * mientras Qwen y DeepSeek compartan transporte. Si un escritor nuevo pidiera
 * otra credencial, la puerta empezaría a validar la equivocada en silencio.
 * Esto lo convierte en una prueba roja.
 */
describe("las imágenes no cambian la credencial", () => {
  it("pide lo mismo con y sin imágenes", () => {
    expect(credencialDelTurno(SOLO_FIREWORKS, true).variable).toBe(
      credencialDelTurno(SOLO_FIREWORKS, false).variable,
    );
  });

  it("y con imágenes el escritor SÍ cambia — si no, la prueba de arriba es vacía", () => {
    expect(writerForTurn(false)).toBe("deepseek");
    expect(writerForTurn(true)).toBe("qwen");
  });
});
