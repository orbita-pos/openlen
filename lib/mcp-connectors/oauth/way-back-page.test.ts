// @vitest-environment node
//
// The pages of the way back (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 step 3, final review F5): the confirm
// page of a phone sign-in names the account (masked) and the server and carries only its one-time token; nothing on it
// is markup it didn't write, and it is never framed.
import { describe, expect, it } from "vitest";

import { confirmPage, COPY, maskEmail, resultPage } from "./way-back-page";

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("jesus@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("a@x.org")).toBe("a***@x.org");
    expect(maskEmail("  Ñandú@correo.es ")).toBe("Ñ***@correo.es");
  });

  it("an address it can't read names nobody", () => {
    for (const bad of [null, undefined, "", "no-at-sign", "@domain.com", "user@"]) expect(maskEmail(bad)).toBe("***");
  });
});

describe("confirmPage", () => {
  it("🔴 draws the server and the account as text, never as markup, and a `$&` stays what it is", async () => {
    const html = await confirmPage("en", `<img src=x onerror=alert(1)>$&`, `"><script>x</script>`, "tok").text();
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;$&amp;");
    expect(html).toContain("&quot;&gt;&lt;script&gt;x&lt;/script&gt;");
  });

  it("🔴 its form posts only to OpenLen's confirm route, with the token as its one field, and the page is never framed", async () => {
    const res = confirmPage("es", "cal", "j***@gmail.com", "tok_1");
    const html = await res.text();
    expect(html).toContain('<form method="post" action="/api/mcp-connectors/oauth/confirm">');
    expect(html.match(/<input/g)).toEqual(["<input"]);
    expect(html).toContain('value="tok_1"');
    expect(html).toContain("¿Conectar «cal» a la cuenta de OpenLen j***@gmail.com?");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("every language has every line, and the question names the server and the account", () => {
    for (const [locale, copy] of Object.entries(COPY)) {
      for (const [key, text] of Object.entries(copy)) expect(text.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      expect(copy.confirmQuestion, locale).toContain("{server}");
      expect(copy.confirmQuestion, locale).toContain("{account}");
    }
  });
});

describe("resultPage", () => {
  it("a payload can't close its own script", async () => {
    const html = await resultPage("en", "x", { type: "openlen:mcp-oauth", server: "</script><b>", ok: false }, 400).text();
    expect(html).not.toContain("</script><b>");
  });
});
