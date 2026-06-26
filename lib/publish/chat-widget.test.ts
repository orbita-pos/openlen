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
});
