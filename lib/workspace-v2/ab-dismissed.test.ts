// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { dismissAb, readDismissedAb } from "./ab-dismissed";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("a harm card put away", () => {
  it("remembers the ids across reads, and only those", () => {
    expect([...readDismissedAb()]).toEqual([]);
    dismissAb("ab_1");
    dismissAb("ab_2");
    expect([...readDismissedAb()].sort()).toEqual(["ab_1", "ab_2"]);
  });

  it("blocked storage: the card is gone for this session and nothing throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect([...readDismissedAb()]).toEqual([]);
    expect(dismissAb("ab_1", new Set(["ab_0"])).has("ab_1")).toBe(true);
  });

  it("a corrupt value reads as nothing dismissed", () => {
    window.localStorage.setItem("openlen.ab.dismissed", "{not json");
    expect([...readDismissedAb()]).toEqual([]);
    window.localStorage.setItem("openlen.ab.dismissed", JSON.stringify({ a: 1 }));
    expect([...readDismissedAb()]).toEqual([]);
  });
});
