// @vitest-environment node

import { describe, expect, it } from "vitest";
import { detectSiteAccent } from "./site-accent";

const page = (body: string) =>
  `<!doctype html><html><head><style>${body}</style></head><body></body></html>`;

describe("detectSiteAccent", () => {
  // Bug cazado en prod (te2, 2026-07-15): la página declaraba
  // --ol-accent:#e05a2b pero un verde regado en el HTML le ganó por
  // frecuencia×chroma al acento OFICIAL. El token declarado MANDA; el
  // escaneo estadístico es solo para HTML sin token (importado/legacy).
  it("the declared --ol-accent token WINS over a more frequent vivid color", () => {
    const html = page(`
      :root{--ol-accent:#e05a2b;--ol-accent-r:224,90,43}
      .a{color:#3ecf8e}.b{background:#3ecf8e}.c{border-color:#3ecf8e}
      .d{color:#3ecf8e}.e{background:#3ecf8e}.f{color:#3ecf8e}
    `);
    expect(detectSiteAccent(html)).toBe("#e05a2b");
  });

  it("an unparseable --ol-accent falls back to the statistical scan", () => {
    const html = page(`
      :root{--ol-accent:var(--broken)}
      .a{color:#3ecf8e}.b{background:#3ecf8e}.c{border-color:#3ecf8e}
    `);
    expect(detectSiteAccent(html)).toBe("#3ecf8e");
  });

  it("a near-white --ol-accent (chrome, not brand) falls back to the scan", () => {
    const html = page(`
      :root{--ol-accent:#fafafa}
      .a{color:#2563eb}.b{background:#2563eb}.c{border-color:#2563eb}
    `);
    expect(detectSiteAccent(html)).toBe("#2563eb");
  });

  it("picks the frequent vivid color over chrome neutrals", () => {
    const html = page(`
      body{background:#ffffff;color:#111111}
      .a{color:#ff5a36}.b{background:#ff5a36}.c{border-color:#ff5a36}
      .d{color:#f4f4f5}.e{color:#18181b}
    `);
    expect(detectSiteAccent(html)).toBe("#ff5a36");
  });

  it("clusters near-identical shades into one accent", () => {
    const html = page(`.a{color:#ff5a36}.b{color:#ff5b37}.c{color:#fe5a35}.d{color:#2563eb}`);
    const accent = detectSiteAccent(html);
    expect(["#ff5a36", "#ff5b37", "#fe5a35"]).toContain(accent);
  });

  it("frequency × chroma: a vivid brand beats a pale tint used more", () => {
    const html = page(`
      .t1{background:#fde8e3}.t2{background:#fde8e3}.t3{background:#fde8e3}.t4{background:#fde8e3}
      .b1{color:#e11d48}.b2{background:#e11d48}.b3{border-color:#e11d48}
    `);
    expect(detectSiteAccent(html)).toBe("#e11d48");
  });

  it("returns null on a grayscale-only page", () => {
    const html = page(`body{background:#fff;color:#000}.x{color:#888;border-color:#e5e5e5}`);
    expect(detectSiteAccent(html)).toBeNull();
  });

  it("ignores transparent and low-alpha tokens", () => {
    const html = page(`.x{background:rgba(255,90,54,0.2)}.y{color:rgba(0,0,0,0)}`);
    expect(detectSiteAccent(html)).toBeNull();
  });

  it("reads rgb() and 3-digit hex too", () => {
    const html = page(`.a{color:rgb(37,99,235)}.b{background:rgb(37, 99, 235)}.c{color:#fff}`);
    expect(detectSiteAccent(html)).toBe("#2563eb");
  });
});
