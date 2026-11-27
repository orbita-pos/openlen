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
    expect(injectAppApi(`<!doctype html><html lang="es"><head><meta charset="utf-8"><script src="/x.js"></script></head></html>`)).toBe(
      `<!doctype html><html lang="es"><head>${TAG}<meta charset="utf-8"><script src="/x.js"></script></head></html>`,
    );
  });

  it("a `>` inside a quoted attribute of <head> does not take the tag into the value", () => {
    expect(injectAppApi(`<html><head data-x="a>b"><meta charset="utf-8"></head></html>`)).toBe(`<html><head data-x="a>b">${TAG}<meta charset="utf-8"></head></html>`);
    expect(injectAppApi(`<html><head data-x='a>b' lang=es><meta charset="utf-8"></head></html>`)).toBe(`<html><head data-x='a>b' lang=es>${TAG}<meta charset="utf-8"></head></html>`);
  });

  it("idempotent when the tag is first in the head; the same tag elsewhere in the document does not count", () => {
    const once = injectAppApi("<html><head></head><body></body></html>");
    expect(injectAppApi(once)).toBe(once);
    expect(injectAppApi(`<html><head></head><body>${TAG}</body></html>`)).toBe(`<html><head>${TAG}</head><body>${TAG}</body></html>`);
    // the other fallbacks are idempotent too
    for (const bare of ["<html><body>hi</body></html>", "<!doctype html><p>hi</p>", "<p>hi</p>"]) {
      const first = injectAppApi(bare);
      expect(injectAppApi(first), bare).toBe(first);
    }
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
    for (const hostile of ["<head ".repeat(200_000), "<head x".repeat(200_000), '<head x="'.repeat(120_000), "<head\n".repeat(200_000), "<html ".repeat(200_000), "<!doctype ".repeat(100_000)]) {
      const started = performance.now();
      const out = injectAppApi(hostile);
      expect(performance.now() - started).toBeLessThan(200);
      expect(out.endsWith(hostile)).toBe(true);
    }
  });
});
