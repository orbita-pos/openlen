import { describe, expect, it } from "vitest";

import { isHttpUrl, linkLabel, normalizeLink, parseProfilePatch } from "./validate";

describe("los enlaces del perfil", () => {
  it("🔴 sin esquema se le pone https; con uno raro, se queda como está y no pasa", () => {
    expect(normalizeLink("  instagram.com/ana ")).toBe("https://instagram.com/ana");
    expect(normalizeLink("https://ana.dev")).toBe("https://ana.dev");
    expect(normalizeLink("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(isHttpUrl(normalizeLink("javascript:alert(1)"))).toBe(false);
    expect(isHttpUrl("data:text/html,hola")).toBe(false);
    expect(isHttpUrl("https://localhost")).toBe(false);
    expect(isHttpUrl("http://ana.dev/x")).toBe(true);
  });

  it("se enseña el nombre del sitio, sin www", () => {
    expect(linkLabel("https://www.instagram.com/ana")).toBe("instagram.com");
    expect(linkLabel("https://github.com/ana")).toBe("github.com");
  });
});

describe("lo que se puede guardar del perfil", () => {
  it("🔴 un enlace inválido dice cuál es", () => {
    const r = parseProfilePatch({ links: ["ana.dev", "javascript:alert(1)"] });
    expect(r).toEqual({ ok: false, path: "links.1" });
  });

  it("los enlaces salen normalizados", () => {
    expect(parseProfilePatch({ links: ["instagram.com/ana"] })).toEqual({ ok: true, patch: { links: ["https://instagram.com/ana"] } });
  });

  it("los topes: 4 enlaces, 6 fijados, 160 de bio, 50 de nombre; nada de campos extra", () => {
    expect(parseProfilePatch({ links: ["a.dev", "b.dev", "c.dev", "d.dev", "e.dev"] })).toMatchObject({ ok: false, path: "links" });
    expect(parseProfilePatch({ pinnedProjectIds: ["1", "2", "3", "4", "5", "6", "7"] })).toMatchObject({ ok: false, path: "pinnedProjectIds" });
    expect(parseProfilePatch({ bio: "x".repeat(161) })).toMatchObject({ ok: false, path: "bio" });
    expect(parseProfilePatch({ bio: "x".repeat(160) }).ok).toBe(true);
    expect(parseProfilePatch({ name: "x".repeat(51) })).toMatchObject({ ok: false, path: "name" });
    expect(parseProfilePatch({ handle: "otro" }).ok).toBe(false);
    expect(parseProfilePatch(null).ok).toBe(false);
  });
});
