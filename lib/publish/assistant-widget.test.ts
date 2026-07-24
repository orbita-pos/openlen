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
});
