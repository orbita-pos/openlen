// @vitest-environment node

import { describe, expect, it } from "vitest";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import { buildGateStub, wireMemberLogout } from "./gate-stub";

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

  it("wears the site accent with readable ink, neutral without it", () => {
    const neutral = buildGateStub(BASE);
    expect(neutral).not.toContain("--btn-bg:#");
    const tinted = buildGateStub({ ...BASE, accent: "#ff5a36" });
    expect(tinted).toContain("--btn-bg:#ff5a36");
    expect(tinted).toMatch(/--btn-fg:#[0-9a-fA-F]{6}/);
    expect(tinted).toContain("--focus:#ff5a36");
  });

  it("ignores malformed accents", () => {
    for (const bad of ["red", "#ff5a3", "#ff5a36aa", "url(x)", ""]) {
      expect(buildGateStub({ ...BASE, accent: bad })).not.toContain("--btn-bg:#");
    }
  });
});

describe("buildGateStub — password card", () => {
  it("passwordLogin:true renders the tabbed auth card and verify state", () => {
    const html = buildGateStub({ ...BASE, passwordLogin: true });
    expect(html).toContain('id="m-auth"');
    expect(html).toContain('id="m-tab-in"');
    expect(html).toContain('id="m-tab-up"');
    expect(html).toContain('id="m-pass"');
    expect(html).toContain('id="m-verify"');
    expect(html).toContain('id="m-vbtn"');
    expect(html).toContain('id="m-link"');
  });

  it("passwordLogin false/absent keeps the legacy magic-link-only form untouched", () => {
    const html = buildGateStub(BASE);
    expect(html).toContain('id="m-form"');
    expect(html).toContain("Enviarme el enlace");
    expect(html).not.toContain('id="m-pass"');
    expect(html).not.toContain('id="m-auth"');
  });

  it("bakes MODE into the script — gate by default, account when requested", () => {
    const gate = buildGateStub({ ...BASE, passwordLogin: true });
    expect(gate).toContain('MODE="gate"');
    const account = buildGateStub({ ...BASE, passwordLogin: true, mode: "account" });
    expect(account).toContain('MODE="account"');
  });

  it("the verify handler resolves the email via /me before requesting a new link", () => {
    const html = buildGateStub({ ...BASE, passwordLogin: true });
    expect(html).toContain('"/me"');
    expect(html).toContain("/auth/request");
  });

  it("renders the new es strings", () => {
    const html = buildGateStub({ ...BASE, passwordLogin: true, locale: "es" });
    expect(html).toContain("Crear cuenta");
    expect(html).toContain("Entrar con un link por correo");
    expect(html).toContain("Confirma tu correo");
  });

  it("keeps the gate invariants — no CSP, noindex, zero protected bytes", () => {
    const html = buildGateStub({ ...BASE, passwordLogin: true });
    expect(html).not.toContain("Content-Security-Policy");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toContain("/c/");
  });

  it("escapes user content in the password card too", () => {
    const html = buildGateStub({
      ...BASE,
      passwordLogin: true,
      projectTitle: `<img src=x onerror=alert(1)>`,
      logoUrl: `https://x.test/l.png" onerror="alert(1)`,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain('onerror="alert');
    expect(html).toContain("&quot; onerror=&quot;");
  });

  it("hardens </script> breakouts in the password card script", () => {
    const html = buildGateStub({
      ...BASE,
      passwordLogin: true,
      sub: "x</script><script>evil" as string,
    });
    expect(html).not.toContain("</script><script>evil");
    expect(html).toContain("\\u003c/script");
  });

  it("renders the password card for every publish locale", () => {
    for (const l of PUBLISH_LOCALES) {
      const html = buildGateStub({ ...BASE, passwordLogin: true, locale: l.code });
      expect(html).toContain(`lang="${l.code}"`);
      expect(html.length).toBeGreaterThan(1000);
    }
  });
});

describe("wireMemberLogout", () => {
  const DOC = (body: string) =>
    `<!doctype html><html><head></head><body>${body}</body></html>`;

  it("wires documents carrying data-ol-logout, before </body>", () => {
    const wired = wireMemberLogout(
      DOC(`<a href="#" data-ol-logout>Salir</a>`),
      "mi-negocio",
    );
    expect(wired).toContain("/api/m/mi-negocio/auth/logout");
    expect(wired.indexOf("<script>")).toBeLessThan(wired.indexOf("</body>"));
    expect(wired).toContain("location.reload()");
  });

  it("no-ops on documents without the attribute", () => {
    const doc = DOC("<p>nada</p>");
    expect(wireMemberLogout(doc, "mi-negocio")).toBe(doc);
  });
});
