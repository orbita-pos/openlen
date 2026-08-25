import { describe, expect, it } from "vitest";
import { credencialDelTurno, faltaCredencial } from "./turn-credentials";
import { writerForTurn, type ProviderSwitch } from "./provider-switch";

const CONMUTADORES: ProviderSwitch[] = [
  "OPENLEN_GENERATE_PROVIDER",
  "OPENLEN_CHAT_PROVIDER",
  "OPENLEN_AGENT_PROVIDER",
];

/** Sólo Fireworks configurado: la caja de Jesús el día que el prepago de Gemini
 *  se agote. Hoy eso devolvía 500 en las tres superficies. */
const SOLO_FIREWORKS = { FIREWORKS_API_KEY: "fw-real" } as const;
const SOLO_GEMINI = { GEMINI_API_KEY: "gm-real" } as const;

describe("credencialDelTurno", () => {
  // 🔴 EL BRAZO DE CONTROL. Es el caso medido: Fireworks bien puesto, Gemini
  // vacía. Si esta prueba pasa con el código viejo, no está comprobando nada.
  it.each(CONMUTADORES)(
    "%s corre con sólo FIREWORKS_API_KEY — el prepago de Gemini agotado no tumba nada",
    (conmutador) => {
      const c = credencialDelTurno(conmutador, SOLO_FIREWORKS);

      expect(c.writer).toBe("deepseek");
      expect(c.variable).toBe("FIREWORKS_API_KEY");
      expect(faltaCredencial(c)).toBeNull();
    },
  );

  it.each(CONMUTADORES)("%s=gemini sí exige GEMINI_API_KEY", (conmutador) => {
    const vuelto = { ...SOLO_GEMINI, [conmutador]: "gemini" };

    const c = credencialDelTurno(conmutador, vuelto);

    expect(c.writer).toBe("gemini");
    expect(c.variable).toBe("GEMINI_API_KEY");
    expect(faltaCredencial(c)).toBeNull();
  });

  // El agujero por el otro lado: hoy la puerta miraba Gemini, pasaba, y el
  // fallo de Fireworks salía a mitad del stream como `missing_key`.
  it.each(CONMUTADORES)(
    "%s sin FIREWORKS_API_KEY falla EN LA PUERTA, no a mitad del stream",
    (conmutador) => {
      const c = credencialDelTurno(conmutador, SOLO_GEMINI);

      expect(c.variable).toBe("FIREWORKS_API_KEY");
      expect(faltaCredencial(c)).toContain("FIREWORKS_API_KEY");
    },
  );

  it("el mensaje nombra la variable que falta, no un modelo cualquiera", () => {
    const c = credencialDelTurno("OPENLEN_CHAT_PROVIDER", {});

    expect(faltaCredencial(c)).toBe(
      "DeepSeek (Fireworks) API key missing — falta FIREWORKS_API_KEY",
    );
  });

  it("una key en blanco cuenta como ausente", () => {
    const c = credencialDelTurno("OPENLEN_GENERATE_PROVIDER", {
      FIREWORKS_API_KEY: "   ",
    });

    expect(c.key).toBeUndefined();
    expect(faltaCredencial(c)).not.toBeNull();
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
  it.each(CONMUTADORES)("%s pide lo mismo con y sin imágenes", (conmutador) => {
    for (const env of [SOLO_FIREWORKS, { ...SOLO_GEMINI, [conmutador]: "gemini" }]) {
      const sin = credencialDelTurno(conmutador, env, false);
      const con = credencialDelTurno(conmutador, env, true);

      expect(con.variable).toBe(sin.variable);
    }
  });

  it("y con imágenes el escritor SÍ cambia — si no, la prueba de arriba es vacía", () => {
    expect(writerForTurn("OPENLEN_CHAT_PROVIDER", false, SOLO_FIREWORKS)).toBe("deepseek");
    expect(writerForTurn("OPENLEN_CHAT_PROVIDER", true, SOLO_FIREWORKS)).toBe("qwen");
  });
});
