import { describe, expect, it } from "vitest";

import { searchMentions } from "./search";
import type { MentionEntry } from "./types";

let n = 0;
function entry(over: Partial<MentionEntry>): MentionEntry {
  n += 1;
  const tag = over.tag ?? "div";
  return {
    key: `k${n}`,
    ruta: "/index.html",
    line: n,
    tag,
    kind: "element",
    name: tag,
    text: "",
    attrs: {},
    component: null,
    parent: null,
    collapsed: false,
    target: { type: "page", page: null, path: `${tag}:nth-of-type(${n})`, tag },
    ...over,
  };
}

const LINK = entry({ tag: "a", kind: "link", name: "Ver el mostrador", text: "Ver el mostrador" });
const HERO = entry({ tag: "h1", kind: "heading", name: "Pan de verdad", text: "Pan de verdad" });
const BY_CLASS = entry({ tag: "div", name: "div.mostrador-wrap", attrs: { className: "mostrador-wrap" } });
const WRAPPER = entry({ tag: "div", name: "div.wrap", attrs: { className: "hero-wrap" }, collapsed: true });
const APP = entry({ tag: "li", name: "Pedido", text: "Pedido", ruta: "/src/Pedidos.tsx", target: { type: "app", path: "/src/Pedidos.tsx", line: 4, tag: "li" } });
const ALL = [HERO, BY_CLASS, LINK, WRAPPER, APP];

const keys = (r: ReturnType<typeof searchMentions>) =>
  r.items.map((i) => (i.type === "element" ? i.entry.key : `file:${i.ruta}`));

describe("searchMentions", () => {
  it("finds «Ver el mostrador» from «ver most»", () => {
    expect(keys(searchMentions(ALL, [], "ver most", 10))[0]).toBe(LINK.key);
  });

  it("ranks a match on visible text above a match on a class", () => {
    const r = keys(searchMentions(ALL, [], "mostrador", 10));
    expect(r.indexOf(LINK.key)).toBeLessThan(r.indexOf(BY_CLASS.key));
  });

  it("ignores accents and case", () => {
    expect(keys(searchMentions(ALL, [], "MOSTRÁDOR", 10))).toContain(LINK.key);
  });

  it("finds an app file's elements and the file itself by its path", () => {
    const r = keys(searchMentions(ALL, ["/src/Pedidos.tsx", "/index.html"], "pedidos.tsx", 10));
    expect(r).toContain(APP.key);
    expect(r).toContain("file:/src/Pedidos.tsx");
    expect(r).not.toContain("file:/index.html");
  });

  it("cuts at the limit and says how many more there are", () => {
    const many = Array.from({ length: 10 }, (_, i) => entry({ tag: "p", text: `Plato ${i}`, name: `Plato ${i}` }));
    const r = searchMentions(many, [], "plato", 3);
    expect(r.items).toHaveLength(3);
    expect(r.more).toBe(7);
  });

  it("hides wrappers on an empty query but finds them when asked for", () => {
    expect(keys(searchMentions(ALL, [], "", 50))).not.toContain(WRAPPER.key);
    expect(keys(searchMentions(ALL, [], "hero-wrap", 50))).toContain(WRAPPER.key);
  });

  it("keeps document order on an empty query, files after elements", () => {
    expect(keys(searchMentions(ALL, ["/LEN.md"], "", 50))).toEqual([HERO.key, BY_CLASS.key, LINK.key, APP.key, "file:/LEN.md"]);
  });
});
