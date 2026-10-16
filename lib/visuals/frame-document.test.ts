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

  it("embeds the parent origins it accepts", () => {
    expect(buildVisualFrameDocument({ parentOrigins: ["https://openlen.com"], cspInMeta: false })).toContain('["https://openlen.com"]');
  });
});
