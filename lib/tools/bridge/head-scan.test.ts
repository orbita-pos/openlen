// @vitest-environment node
import { describe, expect, it } from "vitest";

import { insertFirstInHead, openTagEnd } from "./head-scan";

const TAG = `<script src="/x.js"></script>`;

describe("openTagEnd", () => {
  it("is the index right after the open tag's `>`, whatever the case or the blanks inside it", () => {
    expect(openTagEnd("<html><head><title>x</title></head></html>", "head")).toBe("<html><head>".length);
    expect(openTagEnd("<HTML><HEAD\n lang=x\n><title>t</title>", "head")).toBe("<HTML><HEAD\n lang=x\n>".length);
    expect(openTagEnd(`<!doctype html><html lang="es"><body>`, "html")).toBe(`<!doctype html><html lang="es">`.length);
  });

  it("is not fooled by tags that only begin the same way, and finds the first real one", () => {
    expect(openTagEnd("<header>h</header>", "head")).toBe(-1);
    expect(openTagEnd("<htmlx>", "html")).toBe(-1);
    expect(openTagEnd("<header><head>", "head")).toBe("<header><head>".length);
  });

  it("a `>` inside a quoted attribute value does not end the tag", () => {
    expect(openTagEnd(`<head data-x="a>b"><title>`, "head")).toBe(`<head data-x="a>b">`.length);
    expect(openTagEnd(`<head data-x='a>b'><title>`, "head")).toBe(`<head data-x='a>b'>`.length);
    expect(openTagEnd(`<head data-x = "a>b" data-y="c>d"><title>`, "head")).toBe(`<head data-x = "a>b" data-y="c>d">`.length);
  });

  it("a quote that does not follow `=` is not a value: `a\"b` is an unquoted value and the tag ends at the first `>`", () => {
    expect(openTagEnd(`<head data-x=a"b><title>`, "head")).toBe(`<head data-x=a"b>`.length);
  });

  it("a quote that never closes, or a tag that never closes, is no tag at all", () => {
    expect(openTagEnd(`<head data-x="a>b</head>`, "head")).toBe(-1);
    expect(openTagEnd("<head ", "head")).toBe(-1);
    expect(openTagEnd("<head", "head")).toBe(-1);
    expect(openTagEnd("no tags here", "head")).toBe(-1);
  });

  it("🔴 stays linear on a text built to make a pattern backtrack (the author's, in the server's process)", () => {
    for (const hostile of ["<head ".repeat(200_000), "<head x".repeat(200_000), '<head x="'.repeat(120_000), "<head\n".repeat(200_000), "<html ".repeat(200_000)]) {
      const started = performance.now();
      openTagEnd(hostile, "head");
      openTagEnd(hostile, "html");
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});

describe("insertFirstInHead", () => {
  it("puts the tag right after the head open tag, and says nothing when there is no head", () => {
    expect(insertFirstInHead("<html><head><title>x</title></head></html>", TAG)).toBe(`<html><head>${TAG}<title>x</title></head></html>`);
    expect(insertFirstInHead("<p>hi</p>", TAG)).toBeNull();
    expect(insertFirstInHead(`<head data-x="a>b"><meta charset="utf-8">`, TAG)).toBe(`<head data-x="a>b">${TAG}<meta charset="utf-8">`);
  });

  it("is idempotent only when the tag is the FIRST thing in the head: the same tag elsewhere in the document is not it", () => {
    const once = insertFirstInHead("<html><head><title>x</title></head><body></body></html>", TAG)!;
    expect(insertFirstInHead(once, TAG)).toBe(once);
    const elsewhere = `<html><head><title>x</title></head><body>${TAG}</body></html>`;
    expect(insertFirstInHead(elsewhere, TAG)).toBe(`<html><head>${TAG}<title>x</title></head><body>${TAG}</body></html>`);
    const later = `<html><head><title>x</title>${TAG}</head></html>`;
    expect(insertFirstInHead(later, TAG)).toBe(`<html><head>${TAG}<title>x</title>${TAG}</head></html>`);
  });
});
