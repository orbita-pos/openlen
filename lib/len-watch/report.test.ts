import { describe, expect, it } from "vitest";

import { parseWatchReport, scrubText } from "./report";

describe("parseWatchReport", () => {
  it("scrubs what a visitor's browser sent", () => {
    expect(
      parseWatchReport({
        t: "f",
        m: "fail for ana@x.com token abcdefghijklmnopqrstuvwxyz12 at https://a.b/c?d=1",
        f: "https://s.openlen.app/assets/i.js?v=2",
        l: 3,
        c: 9,
        p: "menu",
      }),
    ).toEqual({ message: "fail for [email] token [token] at https://a.b/c", file: "/assets/i.js", line: 3, col: 9, page: "menu" });
  });

  it("is only for failure reports", () => {
    expect(parseWatchReport({ t: "v" })).toBeNull();
    expect(parseWatchReport(null)).toBeNull();
    expect(parseWatchReport("f")).toBeNull();
  });

  it("drops what isn't what it claims to be", () => {
    expect(parseWatchReport({ t: "f", l: -1, c: 1.5, p: "../x", f: 12, m: "   " })).toEqual({ message: null, file: null, line: null, col: null, page: null });
    expect(parseWatchReport({ t: "f", l: 10_000_001 })?.line).toBeNull();
  });

  it("keeps a message to 300 characters", () => {
    expect(parseWatchReport({ t: "f", m: "ab ".repeat(400) })?.message).toHaveLength(300);
  });

  it("turns a long unbroken run into [token], whatever its length", () => {
    expect(parseWatchReport({ t: "f", m: "x".repeat(1000) })?.message).toBe("[token]");
  });

  it("keeps a file path to 200 characters", () => {
    expect(parseWatchReport({ t: "f", f: `/${"a".repeat(500)}.js` })?.file).toHaveLength(200);
  });
});

describe("scrubText", () => {
  it("hides phone numbers and long digit runs", () => {
    expect(scrubText("call 55 1234 5678 or 555-123-4567 now")).toBe("call [number] or [number] now");
  });

  it("leaves short numbers alone", () => {
    expect(scrubText("line 42 of 1200")).toBe("line 42 of 1200");
  });

  it("strips the query and the hash of any URL", () => {
    expect(scrubText("see https://x.y/z#frag and http://q.r/s?a=1&b=2")).toBe("see https://x.y/z and http://q.r/s");
  });
});
