// Which images of Len's text the chat loads (spec local 2026-10-27-chat-drop-and-images, Part B):
// only the copies `image_search` made in our storage. Anything else — a prompt-injected tracker, a
// look-alike path on another host — stays a link, as before.
import { describe, expect, it } from "vitest";

import { creditFrom, isCommonsCopy, sidecarUrl } from "./commons-image";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("isCommonsCopy", () => {
  it("our copies: same-origin uploads in dev, our static uploads host in production", () => {
    expect(isCommonsCopy(`/uploads/commons/${SHA}-960.jpg`)).toBe(true);
    expect(isCommonsCopy(`https://uploads.openlen.com/commons/${SHA}-960.webp`)).toBe(true);
  });

  it("anything else is not: another host, another folder, another extension, another scheme", () => {
    expect(isCommonsCopy(`https://evil.example/commons/${SHA}-960.jpg`)).toBe(false);
    expect(isCommonsCopy(`http://uploads.openlen.com/commons/${SHA}-960.jpg`)).toBe(false);
    expect(isCommonsCopy(`https://uploads.openlen.com/uploads/p1/${SHA}.jpg`)).toBe(false);
    expect(isCommonsCopy(`/uploads/commons/${SHA}-960.svg`)).toBe(false);
    expect(isCommonsCopy(`/uploads/commons/../secret-960.jpg`)).toBe(false);
    expect(isCommonsCopy(`//evil.example/uploads/commons/${SHA}-960.jpg`)).toBe(false);
    expect(isCommonsCopy("javascript:alert(1)")).toBe(false);
    expect(isCommonsCopy("")).toBe(false);
  });
});

describe("sidecarUrl and creditFrom", () => {
  it("the credit sits beside the photo, as .json", () => {
    expect(sidecarUrl(`/uploads/commons/${SHA}-960.jpg`)).toBe(`/uploads/commons/${SHA}-960.json`);
  });

  it("a credit is read as plain fields, links only to http(s)", () => {
    expect(
      creditFrom({ title: "Axolotl", author: "Stan Shebs", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" }),
    ).toEqual({ title: "Axolotl", author: "Stan Shebs", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" });
    expect(creditFrom({ title: "x", author: "y", license: "z", licenseUrl: "javascript:1", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" })?.licenseUrl).toBeNull();
    expect(creditFrom({ title: "x" })).toBeNull();
    expect(creditFrom(null)).toBeNull();
  });
});
