import { describe, expect, it } from "vitest";
import { bakeChatWidget } from "@/lib/publish/chat-widget";

const BASE = `<!doctype html><html lang="es"><body><main>hi</main></body></html>`;
const cfg = { sub: "demo", accent: "#7C3AED", mount: "fab" as const, selfServeJoin: true };

describe("bakeChatWidget", () => {
  it("injects the widget before </body> and is idempotent", () => {
    const once = bakeChatWidget(BASE, cfg);
    expect(once).toContain("data-ol-chat-widget");
    expect(once.indexOf("</body>")).toBeGreaterThan(once.indexOf("data-ol-chat-widget"));
    expect(bakeChatWidget(once, cfg)).toBe(once); // second bake is a no-op
  });
  it("fills the data-ol-chat-section placeholder in section mode", () => {
    const withSection = `<!doctype html><html lang="es"><body><div data-ol-chat-section></div></body></html>`;
    const out = bakeChatWidget(withSection, { ...cfg, mount: "section" });
    expect(out).toContain("data-ol-chat-widget");
    expect(out).toMatch(/data-ol-chat-section[^>]*>[\s\S]*data-ol-chat-widget/);
  });
  it("never emits data-slot-path and escapes < in config", () => {
    const out = bakeChatWidget(BASE, cfg);
    expect(out).not.toContain("data-slot-path");
    expect(out).not.toContain("</script><");
    expect(out).toContain("#7C3AED");
  });

  // Restyle WhatsApp 2026-07-15
  it("un acento que no es hex NO se interpola al CSS (guard anti-inyección)", () => {
    const out = bakeChatWidget(BASE, { ...cfg, accent: "red}body{background:url(//evil)" });
    expect(out).not.toContain("evil");
    expect(out).toContain("#FF5A36"); // cae al default
  });

  it("sin acento configurado cae al coral OpenLen (#FF5A36), no a un color inventado", () => {
    const out = bakeChatWidget(BASE, { sub: "demo", mount: "fab", selfServeJoin: true });
    expect(out).toContain("#FF5A36");
  });

  // Apilamiento de burbujas: el asistente ocupa los 18 px de la esquina, así
  // que un chat que NO se fusiona con él se hornea una ranura arriba.
  it("bakes the caller's bottom offset into the FAB and the panel", () => {
    const out = bakeChatWidget(BASE, { ...cfg, bottomPx: 86 });
    expect(out).toContain('"bottom":86');
    const own = bakeChatWidget(BASE, cfg);
    expect(own).not.toContain('"bottom"'); // sin offset = 18 px por default
  });

  it("skips the API calls when there is no sub (draft preview shell only)", () => {
    const out = bakeChatWidget(BASE, { ...cfg, sub: "" });
    expect(out).toContain("if(!C.sub){authView();return}");
  });

  it("el script trae la piel WhatsApp: avatar del header, papel tapiz y timestamps", () => {
    const out = bakeChatWidget(BASE, cfg);
    expect(out).toContain('"ava"'); // avatar circle en el header
    expect(out).toContain("radial-gradient"); // papel tapiz
    expect(out).toContain("fmtT"); // formateador de hora de burbuja
    expect(out).toContain('"hello"'); // saludo como burbuja en el form
    // el acento configurado sigue mandando sobre el default
    expect(out).toContain("#7C3AED");
  });
});
