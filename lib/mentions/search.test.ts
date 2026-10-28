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

  it("ranks text that starts with the word above text with a later word starting with it", () => {
    const r = keys(searchMentions(ALL, [], "ver", 10));
    expect(r.indexOf(LINK.key)).toBeLessThan(r.indexOf(HERO.key));
  });

  it("puts an exact text first, ahead of texts that only start with it", () => {
    const pro = entry({ tag: "span", text: "Pro", name: "Pro" });
    const others = ["Productos", "Proyecto", "Promoción", "Proceso", "Propuesta", "Prólogo"].map((t) => entry({ tag: "p", text: t, name: t }));
    expect(keys(searchMentions([...others, pro], [], "Pro", 5))[0]).toBe(pro.key);
  });

  it("in strict mode, only whole-word appearances count, never a scattered subsequence", () => {
    expect(keys(searchMentions(ALL, [], "ver most", 10, { strict: true }))[0]).toBe(LINK.key);
    expect(searchMentions(ALL, [], "vr mstr", 10, { strict: true }).items).toEqual([]);
    expect(searchMentions(ALL, [], "vr mstr", 10).items.length).toBeGreaterThan(0);
  });

  it("folds an entry's fields once, not on every search", () => {
    let reads = 0;
    const base = entry({ tag: "a", text: "Ver el mostrador", name: "Ver el mostrador" });
    const watched = new Proxy(base, {
      get(t, k, r) {
        if (k === "text") reads += 1;
        return Reflect.get(t, k, r);
      },
    });
    searchMentions([watched], [], "ver", 5);
    searchMentions([watched], [], "most", 5);
    searchMentions([watched], [], "el", 5);
    expect(reads).toBe(1);
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
