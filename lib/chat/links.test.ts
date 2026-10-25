import { describe, expect, it } from "vitest";
import { hasLink, splitLinks, trimUrl } from "./links";

describe("splitLinks (GFM autolinks)", () => {
  it("finds the URL the person wrote in production", () => {
    expect(splitLinks("una app como la de https://monkeytype.com/ para practicar")).toEqual([
      { text: "una app como la de " },
      { text: "https://monkeytype.com/", href: "https://monkeytype.com/" },
      { text: " para practicar" },
    ]);
  });

  it.each([
    ["https://x.com.", "https://x.com"],
    ["https://x.com/a?b=1,", "https://x.com/a?b=1"],
    ["https://es.wikipedia.org/wiki/Mate_(bebida)", "https://es.wikipedia.org/wiki/Mate_(bebida)"],
    ["https://x.com/a)", "https://x.com/a"],
    ["https://x.com»", "https://x.com"],
  ])("leaves out what GFM leaves out: %s", (raw, url) => {
    expect(trimUrl(raw)).toBe(url);
  });

  it("a URL inside parentheses doesn't take the closing one", () => {
    expect(splitLinks("(ver https://x.com)").map((p) => p.text)).toEqual(["(ver ", "https://x.com", ")"]);
  });

  it("loses no character", () => {
    const t = "a https://a.com, b http://b.org/x. c https:// d";
    expect(splitLinks(t).map((p) => p.text).join("")).toBe(t);
  });

  it("only http(s), and not a bare scheme", () => {
    expect(hasLink("ftp://x.com javascript:alert(1) https:// www.x.com")).toBe(false);
    expect(hasLink("mira http://x.com")).toBe(true);
  });
});
