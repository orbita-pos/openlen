// The «@» highlight on a PAGE canvas: the section-select script, run as the
// script it is in this window (the test page is the canvas: parent === window).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { elementAtEditPath } from "./edit-path";
import { highlightMention, onMentionHighlighted } from "./mention-highlight";
import { injectSectionSelect } from "./use-section-select";

function injectedSource(): string {
  const out = injectSectionSelect("<html><body></body></html>");
  const m = out.match(/<script[^>]*>([\s\S]*)<\/script>/);
  if (!m) throw new Error("the injection no longer carries a <script>");
  return m[1]!;
}

const replies: { key: string; count: number }[] = [];
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "postMessage").mockImplementation(((data: { type?: string; key: string; count: number }) => {
    if (data?.type === "openlen:mention-highlighted") replies.push({ key: data.key, count: data.count });
  }) as never);
  new Function(injectedSource())();
});
afterEach(() => {
  replies.splice(0);
  document.body.innerHTML = "";
});

function send(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

describe("elementAtEditPath", () => {
  it("walks nth-of-type segments from the root", () => {
    document.body.innerHTML = "<section><h2>A</h2><div><h2>B</h2><a>x</a></div></section>";
    expect(elementAtEditPath("section:nth-of-type(1) > div:nth-of-type(1) > a:nth-of-type(1)", document.body)?.textContent).toBe("x");
    expect(elementAtEditPath("section:nth-of-type(2)", document.body)).toBeNull();
  });
});

describe("the page canvas answers a highlight", () => {
  it("outlines the element at the path and says it found one", () => {
    document.body.innerHTML = "<section><h1>Pan de verdad</h1></section>";
    send({ type: "openlen:mention-highlight", key: "k1", target: { type: "page", page: null, path: "section:nth-of-type(1) > h1:nth-of-type(1)", tag: "h1", text: "Pan de verdad" } });
    expect(document.querySelector("h1")!.hasAttribute("data-openlen-mention-hover")).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(replies).toEqual([{ key: "k1", count: 1 }]);
  });

  it("outlines nothing when a script moved things and the path now lands on a neighbour", () => {
    // Source: one h2 «B». The page's own JS inserted an h2 «A» before it.
    document.body.innerHTML = "<h2>A</h2><h2>B</h2>";
    send({ type: "openlen:mention-highlight", key: "k2", target: { type: "page", page: null, path: "h2:nth-of-type(1)", tag: "h2", text: "B" } });
    expect(document.querySelector("[data-openlen-mention-hover]")).toBeNull();
    expect(replies).toEqual([{ key: "k2", count: 0 }]);
  });

  it("recognises an element whose text a <br> splits, as the index names it", () => {
    document.body.innerHTML = "<h1>NOVA<br>GAMES</h1>";
    send({ type: "openlen:mention-highlight", key: "k5", target: { type: "page", page: null, path: "h1:nth-of-type(1)", tag: "h1", text: "NOVA GAMES" } });
    expect(replies).toEqual([{ key: "k5", count: 1 }]);
  });

  it("clears the outline with a null target", () => {
    document.body.innerHTML = "<p>uno</p>";
    send({ type: "openlen:mention-highlight", key: "k3", target: { type: "page", page: null, path: "p:nth-of-type(1)", tag: "p", text: "uno" } });
    send({ type: "openlen:mention-highlight", key: "k3", target: null });
    expect(document.querySelector("[data-openlen-mention-hover]")).toBeNull();
  });

  it("ignores an app target", () => {
    document.body.innerHTML = "<p>uno</p>";
    send({ type: "openlen:mention-highlight", key: "k4", target: { type: "app", path: "/src/App.tsx", line: 3, tag: "p" } });
    expect(replies).toEqual([]);
  });
});

describe("a click in select mode", () => {
  it("sends the element's own text with its path, for the mention", () => {
    const sent: unknown[] = [];
    vi.mocked(window.postMessage).mockImplementation(((d: unknown) => sent.push(d)) as never);
    document.body.innerHTML = '<section><a href="#">Ver   el\n mostrador<span>x</span></a></section>';
    document.body.setAttribute("data-openlen-select-mode", "");
    document.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.body.removeAttribute("data-openlen-select-mode");
    expect(sent).toContainEqual(expect.objectContaining({ type: "openlen:section-selected", path: "section:nth-of-type(1) > a:nth-of-type(1)", text: "Ver el mostrador" }));
  });
});

describe("the parent-side helpers", () => {
  it("highlightMention posts the target to the canvas window", () => {
    const post = vi.fn();
    const target = { type: "page" as const, page: null, path: "p:nth-of-type(1)", tag: "p" };
    highlightMention({ postMessage: post } as unknown as Window, "k", target);
    expect(post).toHaveBeenCalledWith({ type: "openlen:mention-highlight", key: "k", target }, "*");
    expect(() => highlightMention(null, "k", null)).not.toThrow();
  });

  it("onMentionHighlighted hands over only the canvas's answers, until unsubscribed", () => {
    const seen: [string, number][] = [];
    const off = onMentionHighlighted((k, c) => seen.push([k, c]));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "openlen:mention-highlighted", key: "a", count: 2 } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "openlen:other", key: "b", count: 1 } }));
    off();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "openlen:mention-highlighted", key: "c", count: 1 } }));
    expect(seen).toEqual([["a", 2]]);
  });
});
