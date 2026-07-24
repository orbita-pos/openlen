// @vitest-environment node

import { describe, expect, it } from "vitest";
import { bakeComments, hasCommentsSection } from "./comments-widget";

const CFG = { sub: "mysite", apiBase: "https://openlen.com", page: null };
const DOC = (body: string) => `<!doctype html><html lang="es"><head></head><body>${body}</body></html>`;

describe("bakeComments", () => {
  // Tema por módulo (settings.comments.theme, mismo patrón que chat.theme)
  it("theme dark hornea la paleta oscura (texto claro, tarjetas oscuras)", () => {
    const out = bakeComments(DOC(""), { ...CFG, theme: "dark" });
    expect(out).toContain("color:#e8e8ea");
    expect(out).toContain("background:#1c1f24");
    const light = bakeComments(DOC(""), CFG);
    expect(light).toContain("color:#1a1a1a");
    expect(light).not.toContain("#1c1f24");
  });

  // Restyle 2026-07-15: acento de la página + guard hex
  it("interpola el acento hex al CSS; un acento hostil cae a la tinta neutra", () => {
    const ok = bakeComments(DOC(""), { ...CFG, accent: "#e05a2b" });
    expect(ok).toContain("#e05a2b");
    const bad = bakeComments(DOC(""), { ...CFG, accent: "red}body{background:url(//evil)" });
    expect(bad).not.toContain("evil");
    expect(bad).toContain("#16181d");
  });

  it("appends the widget before </body> when there's no placeholder", () => {
    const out = bakeComments(DOC("<h1>hi</h1>"), CFG);
    expect(out).toContain("data-ol-comments-widget");
    expect(out).toContain("data-ol-comments-host");
    expect(out.indexOf("data-ol-comments-host")).toBeLessThan(out.indexOf("</body>"));
  });

  it("renders IN the placeholder when present, not appended", () => {
    const out = bakeComments(
      DOC('<section data-ol-comments-section><p>Los comentarios aparecerán aquí.</p></section><footer>pie</footer>'),
      CFG,
    );
    // The placeholder copy is replaced by the host; the host sits before the footer.
    expect(out).not.toContain("aparecerán aquí");
    expect(out.indexOf("data-ol-comments-host")).toBeLessThan(out.indexOf("<footer>"));
    // Footer still there.
    expect(out).toContain("pie");
  });

  it("is idempotent (does not double-inject)", () => {
    const once = bakeComments(DOC("<h1>x</h1>"), CFG);
    const twice = bakeComments(once, CFG);
    expect(twice).toBe(once);
    expect((twice.match(/data-ol-comments-widget/g) ?? []).length).toBe(1);
  });

  it("bakes the sub, page slug, and same-host API paths into the script", () => {
    const out = bakeComments(DOC("x"), { ...CFG, page: "blog" });
    expect(out).toContain('"sub":"mysite"');
    expect(out).toContain('"slug":"blog"');
    expect(out).toContain("/api/cm/");
    expect(out).toContain("/api/m/"); // login path for non-members
  });

  it("renders comment bodies via textContent (XSS-safe), never innerHTML", () => {
    const out = bakeComments(DOC("x"), CFG);
    // The runtime sets author/body through textContent; assert the pattern is
    // present and that no comment field is concatenated into innerHTML.
    expect(out).toContain("bd.textContent=c.body");
    expect(out).toContain("nm.textContent=c.authorName");
  });

  it("escapes </script> in the embedded config", () => {
    const out = bakeComments(DOC("x"), { ...CFG, sub: "x</script><script>evil" });
    expect(out).not.toContain("</script><script>evil");
    expect(out).toContain("\\u003c/script");
  });

  // Preview de borrador sin subdominio: /api/cm//comments era una ruta rota.
  it("skips the API calls when there is no sub (draft preview shell only)", () => {
    const out = bakeComments(DOC("x"), { ...CFG, sub: "" });
    expect(out).toContain("if(C.sub){load()");
    expect(out).toContain("else{render([]);login()}");
  });

  it("agrees with the bake about which documents carry a band", () => {
    expect(hasCommentsSection(DOC("<div data-ol-comments-section></div>"))).toBe(true);
    expect(hasCommentsSection(DOC("<h1>sin banda</h1>"))).toBe(false);
    // The predicate gates the publish scope, so it must not fire on a document
    // the bake would NOT treat as a placeholder.
    const notAPlaceholder = DOC("<p>data-ol-comments-section</p>");
    expect(hasCommentsSection(notAPlaceholder)).toBe(false);
    const baked = bakeComments(notAPlaceholder, CFG);
    expect(baked.indexOf("data-ol-comments-host")).toBeGreaterThan(baked.indexOf("<p>"));
  });

  it("embeds ALL locale strings and picks by <html lang> at runtime", () => {
    // The same baked widget must render correctly on translated locale
    // variants, so it carries every locale and reads document.lang live.
    const out = bakeComments(DOC("x"), CFG);
    expect(out).toContain("Comentarios"); // es embedded
    expect(out).toContain('"title":"Comments"'); // en embedded
    expect(out).toContain("Kommentare"); // de embedded
    expect(out).toContain("document.documentElement.lang");
    expect(out).toContain("C.S[L]||C.S.en"); // runtime fallback to en
  });
});
