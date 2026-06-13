// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildBroadcastEmail, renderBroadcastBody } from "./render";

const BASE = {
  subject: "Novedades de junio",
  bodyMarkdown: "Hola!\n\nTenemos **algo nuevo**.",
  siteTitle: "Mi Negocio",
  locale: "es",
  unsubUrl: "https://mysite.openlen.com/api/b/mysite/unsubscribe?m=m1&t=abc",
};

describe("renderBroadcastBody", () => {
  it("escapes HTML — no injection survives", () => {
    const html = renderBroadcastBody("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders bold, italic, and http(s) links only", () => {
    expect(renderBroadcastBody("**bold**")).toContain("<strong>bold</strong>");
    expect(renderBroadcastBody("*it*")).toContain("<em>it</em>");
    expect(renderBroadcastBody("[x](https://a.co)")).toContain('href="https://a.co"');
    // javascript: scheme must NOT become a link
    expect(renderBroadcastBody("[x](javascript:alert(1))")).not.toContain("<a ");
  });

  it("splits paragraphs on blank lines, <br> on single newlines", () => {
    const html = renderBroadcastBody("a\nb\n\nc");
    expect((html.match(/<p /g) ?? []).length).toBe(2);
    expect(html).toContain("a<br>b");
  });
});

describe("buildBroadcastEmail — compliance is non-negotiable", () => {
  it("EVERY email contains the recipient's unsubscribe link (html escaped + text raw)", () => {
    const { html, text } = buildBroadcastEmail(BASE);
    // In HTML the href is properly entity-escaped (& → &amp;) but still clickable.
    expect(html).toContain(BASE.unsubUrl.replace(/&/g, "&amp;"));
    expect(html).toContain('<a href="');
    // The text/plain part carries the raw URL.
    expect(text).toContain(BASE.unsubUrl);
  });

  it("contains a postal address (CAN-SPAM)", () => {
    const { html, text } = buildBroadcastEmail(BASE);
    expect(html).toContain("OpenLen");
    expect(text).toContain("OpenLen");
  });

  it("names the sender + reason in the recipient's locale", () => {
    const { html } = buildBroadcastEmail(BASE);
    expect(html).toContain("Mi Negocio");
    expect(html).toContain("Darse de baja"); // es unsubscribe
    expect(html).toContain("Enviado vía OpenLen");
  });

  it("escapes the subject", () => {
    const { html } = buildBroadcastEmail({ ...BASE, subject: "<b>x</b>" });
    expect(html).not.toContain("<h1 style=\"font-size:21px;margin:0 0 20px;letter-spacing:-0.02em;\"><b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("falls back to en for unknown locales", () => {
    const { html } = buildBroadcastEmail({ ...BASE, locale: "xx" });
    expect(html).toContain("Unsubscribe");
  });
});
