import { describe, expect, it } from "vitest";
import { bakeAssistantWidget } from "./assistant-widget";

const DOC = "<!doctype html><html><body><h1>Hi</h1></body></html>";
const CFG = {
  sub: "tacos",
  apiBase: "https://openlen.com",
  businessName: "Tacos La Norteña",
};

describe("bakeAssistantWidget", () => {
  it("injects the IIFE right before </body>", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    expect(out).toContain("data-openlen-assistant");
    expect(out.indexOf("data-openlen-assistant")).toBeLessThan(
      out.indexOf("</body>"),
    );
    expect(out).toContain("attachShadow");
  });

  it("is idempotent — a second bake is a no-op", () => {
    const once = bakeAssistantWidget(DOC, CFG);
    const twice = bakeAssistantWidget(once, CFG);
    expect(twice).toBe(once);
    expect(twice.match(/data-openlen-assistant/g)).toHaveLength(1);
  });

  it("wires both endpoints with the configured base + sub", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    expect(out).toContain('"api":"https://openlen.com"');
    expect(out).toContain('"sub":"tacos"');
    // Runtime concatenates api+"/api/assistant/"+sub and api+"/api/f/"+sub.
    expect(out).toContain('/api/assistant/');
    expect(out).toContain('/api/f/');
  });

  it("defaults greeting from the business name and keeps branding", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    expect(out).toContain("Tacos La Norteña");
    expect(out).toContain("openlen.com");
  });

  it("ships the 10 locales and picks one from <html lang> at runtime", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
      expect(out).toContain(`"${l}":{"open":`);
    }
    expect(out).toContain("document.documentElement.lang");
    expect(out).toContain("C.S.en"); // unknown lang falls back to English
  });

  it("bakes no UI text into the markup — labels come from the locale table", () => {
    const out = bakeAssistantWidget(DOC, { ...CFG, chatHandoff: true });
    expect(out).not.toContain('aria-label="Abrir chat de ayuda"');
    expect(out).not.toContain(">Hablar con una persona<");
    expect(out).toContain('"greeting":null');
    expect(out).toContain('T.greeting.split("{name}")');
  });

  it("keeps a configured greeting verbatim", () => {
    const out = bakeAssistantWidget(DOC, { ...CFG, greeting: "Buenas 🌮" });
    expect(out).toContain('"greeting":"Buenas 🌮"');
  });

  it("drives the branding footer from config (runtime-gated)", () => {
    expect(bakeAssistantWidget(DOC, CFG)).toContain('"branding":true');
    expect(
      bakeAssistantWidget(DOC, { ...CFG, branding: false }),
    ).toContain('"branding":false');
  });

  it("appends when there is no </body>", () => {
    const out = bakeAssistantWidget("<h1>fragment</h1>", CFG);
    expect(out).toContain("data-openlen-assistant");
  });

  it("JSON-escapes config so a quote in the name can't break out", () => {
    const out = bakeAssistantWidget(DOC, {
      ...CFG,
      businessName: 'Bob"s </script> Tacos',
    });
    // The business name is JSON-encoded inside the config blob and every "<" is
    // \u003c-escaped, so the literal </script> can never close the tag early.
    expect(out).toContain('Bob\\"s');
    expect(out).toContain("\\u003c/script>");
  });

  // EL ICONO DE LA BURBUJA TIENE QUE LEERSE CON CUALQUIER ACENTO.
  //
  // Aqui habia un color:#fff a pelo sobre el acento, en seis sitios. MEDIDO el
  // 2026-09-16: blanco sobre #f5c542 da 1,62:1, sobre #7dd3fc 1,67:1 y sobre
  // #34d399 1,92:1, contra el umbral de 3:1 de un elemento no textual.
  //
  // 🔴 Y NO LO VEIA NADIE. La burbuja monta en shadow DOM y la pasada
  // determinista recorre el documento claro: medido sobre las 231 plantillas
  // del corpus, no ve el boton en 443 de 462 miradas. Este defecto no podia
  // salir por ningun lado, ni al usuario ni al modelo.
  describe("el icono se calcula, no se asume blanco", () => {
    /** La misma funcion que va inyectada, sacada del script para poder
     *  ejercitarla sin navegador. Si alguien cambia la del widget y no esta,
     *  el primer `it` de abajo se pone rojo. */
    function fgDelWidget(script: string): (a: string) => string {
      const m = /var FG=\(function\(a\)\{[\s\S]*?\}\)\(ACC\);/.exec(script);
      if (!m) throw new Error("no esta la funcion FG en el script inyectado");
      const cuerpo = m[0].replace("var FG=", "return ").replace("(ACC);", ";");
      return new Function(cuerpo)() as (a: string) => string;
    }

    it("🔴 un acento CLARO deja de llevar icono blanco", () => {
      const fg = fgDelWidget(bakeAssistantWidget(DOC, CFG));
      // Los tres medidos, y el blanco puro que es el caso limite.
      expect(fg("#f5c542")).toBe("#1a1a1a");
      expect(fg("#7dd3fc")).toBe("#1a1a1a");
      expect(fg("#34d399")).toBe("#1a1a1a");
      expect(fg("#ffffff")).toBe("#1a1a1a");
    });

    it("🔴 MINIMA INTERVENCION: lo que ya funcionaba no se toca", () => {
      // El acento por defecto cumple (3,10:1). Con la regla de "el que mas
      // contraste da" pasaba a icono casi negro, o sea que le cambiaba la cara
      // a todas las paginas publicadas sin que nadie lo pidiera. Esta prueba es
      // la que impide volver a esa regla.
      const fg = fgDelWidget(bakeAssistantWidget(DOC, CFG));
      expect(fg("#FF5A36")).toBe("#fff");
      expect(fg("#1f5f4f")).toBe("#fff");
      expect(fg("#111111")).toBe("#fff");
    });

    it("una entrada que no es un color no rompe la burbuja", () => {
      const fg = fgDelWidget(bakeAssistantWidget(DOC, CFG));
      expect(fg("rojo")).toBe("#fff");
      expect(fg("")).toBe("#fff");
    });

    it("BRAZO DE CONTROL: ya no queda un blanco a pelo sobre el acento", () => {
      // Sin esto, alguien puede anadir un septimo sitio con color:#fff y las
      // pruebas de arriba siguen verdes porque la funcion FG sigue bien.
      const out = bakeAssistantWidget(DOC, CFG);
      expect(out).not.toContain("+ACC+';color:#fff");
    });
  });
});
