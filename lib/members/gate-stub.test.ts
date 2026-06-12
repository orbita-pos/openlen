// @vitest-environment node

import { describe, expect, it } from "vitest";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import { buildGateStub } from "./gate-stub";

const BASE = {
  sub: "mi-negocio",
  slug: "miembros",
  projectTitle: "Mi Negocio",
  locale: "es",
};

describe("buildGateStub", () => {
  it("carries NO CSP meta — sealing the stub would break the swap", () => {
    expect(buildGateStub(BASE)).not.toContain("Content-Security-Policy");
  });

  it("is noindex and self-identifies as a gate", () => {
    const html = buildGateStub(BASE);
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('name="ol-member-gate"');
  });

  it("contains zero analytics and zero protected bytes", () => {
    const html = buildGateStub(BASE);
    expect(html).not.toContain("/c/");
    expect(html).toContain('/api/m/"+SUB');
  });

  it("bakes sub + slug JSON-safely into the script", () => {
    const html = buildGateStub(BASE);
    expect(html).toContain('SUB="mi-negocio"');
    expect(html).toContain('SLUG="miembros"');
  });

  it("escapes user content — title and logo URL", () => {
    const html = buildGateStub({
      ...BASE,
      projectTitle: `<img src=x onerror=alert(1)>`,
      logoUrl: `https://x.test/l.png" onerror="alert(1)`,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain('onerror="alert');
    expect(html).toContain("&quot; onerror=&quot;");
  });

  it("hardens </script> breakouts in embedded JSON", () => {
    const html = buildGateStub({ ...BASE, sub: "x</script><script>evil" as string });
    expect(html).not.toContain("</script><script>evil");
    expect(html).toContain("\\u003c/script");
  });

  it("renders the page language and falls back to en", () => {
    expect(buildGateStub(BASE)).toContain('lang="es"');
    expect(buildGateStub(BASE)).toContain("Solo miembros");
    const fallback = buildGateStub({ ...BASE, locale: "xx" });
    expect(fallback).toContain('lang="en"');
    expect(fallback).toContain("Members only");
    expect(buildGateStub({ ...BASE, locale: null })).toContain('lang="en"');
  });

  it("has a string table for every publish locale", () => {
    for (const l of PUBLISH_LOCALES) {
      const html = buildGateStub({ ...BASE, locale: l.code });
      expect(html).toContain(`lang="${l.code}"`);
      expect(html.length).toBeGreaterThan(1000);
    }
  });

  it("shows the logo only when provided", () => {
    expect(buildGateStub(BASE)).not.toContain("<img");
    expect(
      buildGateStub({ ...BASE, logoUrl: "https://images.openlen.com/logo.png" }),
    ).toContain('src="https://images.openlen.com/logo.png"');
  });

  it("falls back to the sub when the title is blank", () => {
    const html = buildGateStub({ ...BASE, projectTitle: "  " });
    expect(html).toContain("<h1>mi-negocio</h1>");
  });
});
