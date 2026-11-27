// @vitest-environment node
import { describe, expect, it } from "vitest";

import { injectAppApi } from "./inject";
import { APP_API_PATH } from "./protocol";

const TAG = `<script src="${APP_API_PATH}"></script>`;

describe("injectAppApi", () => {
  it("puts the script first in <head>, once", () => {
    const once = injectAppApi("<html><head><title>x</title></head></html>");
    expect(once).toBe(`<html><head>${TAG}<title>x</title></head></html>`);
    expect(injectAppApi(once)).toBe(once);
  });

  it("goes before whatever else the head begins with", () => {
    const html = injectAppApi(`<!doctype html><html lang="es"><head data-x="a>b"><meta charset="utf-8"><script src="/x.js"></script></head></html>`);
    expect(html.indexOf(TAG)).toBeLessThan(html.indexOf("charset"));
    expect(html.indexOf(TAG)).toBeLessThan(html.indexOf("/x.js"));
  });

  it("is not fooled by <header>", () => {
    expect(injectAppApi("<html><body><header>h</header></body></html>")).not.toContain(`<header>${TAG}`);
  });

  it("without a <head>, inside a new one right after <html>", () => {
    expect(injectAppApi(`<!doctype html><html lang="en"><body>hi</body></html>`)).toBe(`<!doctype html><html lang="en"><head>${TAG}</head><body>hi</body></html>`);
  });

  it("without <head> or <html>, after the doctype so it stays standards mode", () => {
    expect(injectAppApi("<!DOCTYPE html>\n<p>hi</p>")).toBe(`<!DOCTYPE html>${TAG}\n<p>hi</p>`);
  });

  it("with nothing to hang on, before everything", () => {
    expect(injectAppApi("<p>hi</p>")).toBe(`${TAG}<p>hi</p>`);
  });

  it("is case-insensitive, and takes a <head> split over lines", () => {
    expect(injectAppApi("<HTML><HEAD\n lang=x\n><title>t</title></HEAD></HTML>")).toBe(`<HTML><HEAD\n lang=x\n>${TAG}<title>t</title></HEAD></HTML>`);
  });

  it("🔴 stays linear on a shell built to make a pattern backtrack (the author's text, the server's process)", () => {
    const big = (s: string) => s.repeat(Math.ceil(1_000_000 / s.length));
    for (const hostile of [big("<head "), big("<head x"), big("<html "), big("<!doctype "), big("<head\n")]) {
      const started = Date.now();
      const out = injectAppApi(hostile);
      expect(Date.now() - started).toBeLessThan(500);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
