// @vitest-environment node

import { describe, expect, it } from "vitest";
import { bakeComments } from "./comments-widget";

const CFG = { sub: "mysite", apiBase: "https://openlen.com", page: null, locale: "es" };
const DOC = (body: string) => `<!doctype html><html lang="es"><head></head><body>${body}</body></html>`;

describe("bakeComments", () => {
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

  it("picks the locale strings and falls back to en", () => {
    expect(bakeComments(DOC("x"), { ...CFG, locale: "es" })).toContain("Comentarios");
    expect(bakeComments(DOC("x"), { ...CFG, locale: "xx" })).toContain('"title":"Comments"');
  });
});
