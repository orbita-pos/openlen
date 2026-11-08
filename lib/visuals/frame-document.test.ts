import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VISUAL_TOKENS } from "@/lib/agent/visuals/manual";
import { LUCIDE_FONT_VERSION, VISUALS_CDN_ORIGINS, buildVisualFrameDocument, visualFrameCsp } from "./frame-document";

const CDNS = ["https://cdnjs.cloudflare.com", "https://esm.sh", "https://cdn.jsdelivr.net", "https://unpkg.com"];

describe("visualFrameCsp", () => {
  const csp = visualFrameCsp(null);

  it("starts from nothing and opens only the CDNs", () => {
    expect([...VISUALS_CDN_ORIGINS]).toEqual(CDNS);
    expect(csp).toContain("default-src 'none'");
    for (const directive of ["script-src", "style-src", "font-src", "img-src", "connect-src"]) {
      const part = csp.split(";").find((d) => d.trim().startsWith(directive))!;
      for (const cdn of CDNS) expect(part, directive).toContain(cdn);
    }
  });

  it("lets Google Fonts in for styles and font files only", () => {
    const part = (name: string) => csp.split(";").find((d) => d.trim().startsWith(name))!;
    expect(part("style-src")).toContain("https://fonts.googleapis.com");
    expect(part("font-src")).toContain("https://fonts.gstatic.com");
    expect(part("connect-src")).not.toContain("fonts.googleapis.com");
  });

  it("sends no form anywhere and loads no frame", () => {
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-src 'none'");
  });

  it("carries frame-ancestors only when given", () => {
    expect(csp).not.toContain("frame-ancestors");
    expect(visualFrameCsp("https://openlen.com")).toContain("frame-ancestors https://openlen.com");
  });
});

describe("buildVisualFrameDocument", () => {
  it("with cspInMeta, the policy goes in a meta tag, without frame-ancestors", () => {
    const doc = buildVisualFrameDocument({ parentOrigins: ["https://openlen.com"], cspInMeta: true });
    expect(doc).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'/);
    expect(doc).not.toContain("frame-ancestors");
  });

  it("without it, no meta policy at all (the header carries it)", () => {
    expect(buildVisualFrameDocument({ parentOrigins: [], cspInMeta: false })).not.toContain("http-equiv");
  });

  it("defines every variable of the manual and loads the Lucide font", () => {
    const doc = buildVisualFrameDocument({ parentOrigins: [], cspInMeta: false });
    for (const t of VISUAL_TOKENS) expect(doc).toContain(`${t.name}:`);
    expect(LUCIDE_FONT_VERSION).toBe("1.16.0");
    expect(doc).toContain('href="https://cdn.jsdelivr.net/npm/lucide-static@1.16.0/font/lucide.css"');
  });

  it("the root contains its children's margins, so the measured height doesn't cut the bottom", () => {
    expect(buildVisualFrameDocument({ parentOrigins: [], cspInMeta: false })).toMatch(/#root \{[^}]*display: flow-root/);
  });

  it("embeds the parent origins it accepts", () => {
    expect(buildVisualFrameDocument({ parentOrigins: ["https://openlen.com"], cspInMeta: false })).toContain('["https://openlen.com"]');
  });
});

// THE PERSON'S OWN ASSISTANT'S BUBBLE (spec local 2026-11-06-asistente-propio, §5; phase 2B): her visuals run in a
// sandboxed srcdoc frame on someone's published page, «sin poder mandar datos a ningún sitio».
describe("the closed frame", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const directive = (csp: string, name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

  it("🔴 the closed frame can't send anything anywhere", () => {
    const csp = visualFrameCsp(null, { closed: true });
    expect(directive(csp, "connect-src")).toBe("connect-src 'none'");
    expect(directive(csp, "img-src")).toBe("img-src data: blob:");
    expect(directive(csp, "form-action")).toBe("form-action 'none'");
    expect(directive(csp, "frame-src")).toBe("frame-src 'none'");
    const doc = buildVisualFrameDocument({ parentOrigins: [], cspInMeta: true, closed: true });
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("img-src data: blob:");
  });

  it("Len's frame is byte for byte today's", () => {
    // Pinned from the unchanged file on 08/11, before the closed frame existed.
    expect(sha(buildVisualFrameDocument({ parentOrigins: [], cspInMeta: true }))).toBe("18143c42aa467f31536af410830ce3926785d9682391a2c1a3c937e68f942fd1");
    expect(sha(buildVisualFrameDocument({ parentOrigins: ["https://openlen.com"], cspInMeta: false }))).toBe("9334ba46caa82a60ff8bfd6e62138d50348abd3b050bd774c379a6302ca5f95a");
    expect(sha(visualFrameCsp("https://openlen.com"))).toBe("0c404282b62471a5771b6b057f9588dd52c61783438a93e226829a0fe1984e60");
  });
});
