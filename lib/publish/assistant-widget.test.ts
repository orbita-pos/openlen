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
    // The business name is JSON-encoded inside the config blob; the literal
    // </script> survives as escaped text, never as a real closing tag inside
    // the JSON string.
    expect(out).toContain('Bob\\"s');
  });
});
