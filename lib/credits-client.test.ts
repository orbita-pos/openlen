import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { creditRefillLabel, noCreditsRefill, noCreditsText } from "./credits-client";

const ISO = "2026-09-23T12:00:00.000Z";

describe("noCreditsRefill", () => {
  it("extrae el instante de renovación del único error que lo lleva", () => {
    expect(noCreditsRefill("no_credits", { refillsAt: ISO })).toEqual({
      refillsAt: ISO,
    });
  });

  it("no interfiere con los demás códigos localizados del Agente", () => {
    expect(noCreditsRefill("upstream", { refillsAt: ISO })).toBeNull();
    expect(noCreditsRefill(undefined, { refillsAt: ISO })).toBeNull();
  });

  it("sin fecha sigue siendo la puerta de créditos, no un error genérico", () => {
    // El servidor manda refillsAt: null cuando la fila del usuario no tiene
    // ancla. Perder la fecha no puede degradar el mensaje a «algo salió mal».
    expect(noCreditsRefill("no_credits", { refillsAt: null })).toEqual({
      refillsAt: null,
    });
    expect(noCreditsRefill("no_credits", {})).toEqual({ refillsAt: null });
  });
});

describe("creditRefillLabel", () => {
  it("dice el día en el idioma y la zona de quien lee, no en UTC fijo", () => {
    expect(creditRefillLabel(ISO, "es")).toBe("23 de septiembre de 2026");
    expect(creditRefillLabel(ISO, "en")).toBe("September 23, 2026");
    expect(creditRefillLabel(ISO, "de")).toBe("23. September 2026");
  });

  it("una fecha ilegible cae al texto sin fecha en vez de imprimir basura", () => {
    expect(creditRefillLabel(null, "es")).toBeNull();
    expect(creditRefillLabel("mañana", "es")).toBeNull();
  });
});

describe("noCreditsText", () => {
  // El traductor falso devuelve la clave y el valor, así la prueba comprueba
  // QUÉ cuerda se pide — no el texto español, que es justo lo que no debe
  // llegarle a quien lee en otro idioma.
  const fake = (key: string, values?: { date: string }) =>
    values ? `${key}|${values.date}` : key;

  it("con fecha pide la cuerda con {date}, ya formateada en el locale", () => {
    expect(noCreditsText("no_credits", { refillsAt: ISO }, "en", fake)).toBe(
      "no_credits_at|September 23, 2026",
    );
    expect(noCreditsText("no_credits", { refillsAt: ISO }, "ja", fake)).toBe(
      "no_credits_at|2026年9月23日",
    );
  });

  it("sin fecha pide la cuerda sin fecha, no una con «undefined» dentro", () => {
    expect(noCreditsText("no_credits", { refillsAt: null }, "es", fake)).toBe(
      "no_credits",
    );
  });

  it("no secuestra ningún otro error", () => {
    expect(noCreditsText("truncated", { refillsAt: ISO }, "es", fake)).toBeNull();
  });
});

describe("el muro de créditos habla el idioma del lector", () => {
  // 🔴 Si el cliente se quedara con el `message` del servidor, quien escribe
  // en japonés leería español justo en el momento de pedirle dinero. La fecha
  // viaja como dato precisamente para que esto no pase: la prueba exige que
  // TODOS los locales tengan las dos cuerdas, con y sin fecha.
  const LOCALES = readdirSync(resolve(process.cwd(), "messages")).filter((d) =>
    /^[a-z]{2}$/.test(d),
  );

  it("los 10 locales tienen las dos cuerdas del Chat/Agente", () => {
    expect(LOCALES.length).toBe(10);
    for (const locale of LOCALES) {
      const messages = JSON.parse(
        readFileSync(resolve(process.cwd(), `messages/${locale}/wsPage.json`), "utf8"),
      ) as { agent: { errors: Record<string, string> } };
      const errors = messages.agent.errors;
      expect(errors.no_credits, locale).toBeTypeOf("string");
      expect(errors.no_credits_at, locale).toContain("{date}");
    }
  });

  it("los 10 locales tienen el panel propio de la superficie Crear", () => {
    for (const locale of LOCALES) {
      const messages = JSON.parse(
        readFileSync(resolve(process.cwd(), `messages/${locale}/wsPage.json`), "utf8"),
      ) as { aiError: { noCredits?: Record<string, string> } };
      const panel = messages.aiError.noCredits;
      expect(panel, locale).toBeDefined();
      for (const key of ["title", "reason", "refill", "cta"]) {
        expect(panel?.[key], `${locale}.${key}`).toBeTypeOf("string");
      }
      expect(panel?.refillAt, locale).toContain("{date}");
    }
  });

  it("sólo el español coincide con el mensaje que manda el servidor", () => {
    // Control: si alguien vuelve a «unificar» las 10 cuerdas copiando la
    // castellana, esta prueba lo ve.
    const read = (locale: string) =>
      (
        JSON.parse(
          readFileSync(resolve(process.cwd(), `messages/${locale}/wsPage.json`), "utf8"),
        ) as { agent: { errors: Record<string, string> } }
      ).agent.errors.no_credits_at;
    const es = read("es");
    for (const locale of LOCALES.filter((l) => l !== "es")) {
      expect(read(locale), locale).not.toBe(es);
    }
  });
});

describe("el refresco del saldo sigue cableado tras un turno bueno", () => {
  it("mantiene cableado el refresco tras las dos rutas exitosas de Chat", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/workspace-v2/panels/chat-panel.tsx"),
      "utf8",
    );
    const calls = source.match(/notifyCreditBalanceChanged\(\);/g) ?? [];
    const classicStart = source.indexOf("scanController.finish(() => {");
    const classicEnd = source.indexOf("} catch (err) {", classicStart);
    const agentStart = source.indexOf("// Turn concluded well");
    const agentEnd = source.indexOf("} catch (err) {", agentStart);

    expect(calls).toHaveLength(2);
    expect(source).toContain('from "@/lib/credits-client";');
    // Las DOS ramas de error del panel (Agente y ai-design clásico) tienen que
    // pasar por el muro compartido; si una vuelve a mostrar el `message` del
    // servidor, ese idioma se pierde sin que nadie se entere.
    expect(source.match(/creditWallText\(/g) ?? []).toHaveLength(3);
    expect(source).toContain("creditWallText(code, payload, locale, tAgent)");
    expect(source).toContain("creditWallText(data.code, payload, locale, tAgent)");
    expect(classicStart).toBeGreaterThan(-1);
    expect(classicEnd).toBeGreaterThan(classicStart);
    expect(
      source.slice(classicStart, classicEnd).match(/notifyCreditBalanceChanged\(\);/g),
    ).toHaveLength(1);
    expect(agentStart).toBeGreaterThan(-1);
    expect(agentEnd).toBeGreaterThan(agentStart);
    expect(
      source.slice(agentStart, agentEnd).match(/notifyCreditBalanceChanged\(\);/g),
    ).toHaveLength(1);
  });
});
