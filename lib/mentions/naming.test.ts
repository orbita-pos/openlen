import { describe, expect, it } from "vitest";

import { humanNameOf, kindOf } from "./naming";

describe("kindOf", () => {
  it.each([
    ["a", {}, null, "link"],
    ["a", {}, "button", "button"],
    ["button", {}, null, "button"],
    ["h2", {}, null, "heading"],
    ["img", {}, null, "image"],
    ["section", {}, null, "section"],
    ["header", {}, null, "section"],
    ["iframe", {}, null, "embed"],
    ["canvas", {}, null, "media"],
    ["Button", {}, null, "button"],
    ["div", {}, null, "element"],
  ] as const)("%s (role %s) is a %s", (tag, attrs, role, kind) => {
    expect(kindOf(tag, attrs, role)).toBe(kind);
  });
});

describe("humanNameOf", () => {
  it("prefers the element's own visible text over its alt", () => {
    expect(humanNameOf({ tag: "a", ownText: "Ver el mostrador", attrs: { alt: "x" } })).toBe("Ver el mostrador");
  });

  it("falls back to alt", () => {
    expect(humanNameOf({ tag: "img", ownText: "", attrs: { alt: "pan sobre la mesa", title: "t" } })).toBe("pan sobre la mesa");
  });

  it("falls back to aria-label", () => {
    expect(humanNameOf({ tag: "button", ownText: "", attrs: { ariaLabel: "Cerrar", title: "t" } })).toBe("Cerrar");
  });

  it("falls back to title", () => {
    expect(humanNameOf({ tag: "span", ownText: "", attrs: { title: "Ayuda", placeholder: "p" } })).toBe("Ayuda");
  });

  it("falls back to placeholder", () => {
    expect(humanNameOf({ tag: "input", ownText: "", attrs: { placeholder: "Tu correo" } })).toBe("Tu correo");
  });

  it("names a section by its first heading", () => {
    expect(humanNameOf({ tag: "section", ownText: "", attrs: {}, firstHeadingText: "El mostrador" })).toBe("El mostrador");
  });

  it("names a JSX element by its component when nothing else says anything", () => {
    expect(humanNameOf({ tag: "div", ownText: "", attrs: {}, component: "TarjetaPedido" })).toBe("TarjetaPedido");
  });

  it("falls back to tag.firstClass, then to the bare tag", () => {
    expect(humanNameOf({ tag: "div", ownText: "", attrs: { className: "hero-foot lede" } })).toBe("div.hero-foot");
    expect(humanNameOf({ tag: "div", ownText: "", attrs: {} })).toBe("div");
  });

  it("collapses whitespace and cuts long text at 60 characters", () => {
    expect(humanNameOf({ tag: "p", ownText: "Pan  de\n verdad", attrs: {} })).toBe("Pan de verdad");
    const long = "a".repeat(80);
    expect(humanNameOf({ tag: "p", ownText: long, attrs: {} })).toBe(`${"a".repeat(60)}…`);
  });
});
