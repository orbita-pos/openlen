// @vitest-environment node

import { describe, expect, it } from "vitest";
import { detectSiteAccent } from "./site-accent";

const page = (body: string) =>
  `<!doctype html><html><head><style>${body}</style></head><body></body></html>`;

describe("detectSiteAccent", () => {
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
